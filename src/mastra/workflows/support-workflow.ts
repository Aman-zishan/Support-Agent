import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { triageAgent } from "../agents/triage";
import { billingAgent } from "../agents/billing";
import { technicalAgent } from "../agents/technical";
import { accountAgent } from "../agents/account";
import { processRefund } from "../tools";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const workflowInputSchema = z.object({
  ticketContent: z
    .string()
    .min(10, "Ticket must be at least 10 characters")
    .max(5000, "Ticket must be at most 5000 characters"),
  customerId: z
    .string()
    .regex(/^C\d{3,}$/, "Customer ID must match format C001"),
});

const triageOutputSchema = z.object({
  category: z.enum(["billing", "technical", "account"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  summary: z.string(),
  reasoning: z.string(),
});

const specialistOutputSchema = z.object({
  response: z.string(),
  action: z.enum(["refund", "escalate", "resolved", "info_needed"]),
  refundAmount: z.number().nullable().optional(),
  orderId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  reason: z.string(),
});

// ─── Step 0: Validate Ticket (Guardrails) ────────────────────────────────────

const validateTicketStep = createStep({
  id: "validate-ticket",
  description: "Validate input and detect prompt injection / PII",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    ticketContent: z.string(),
    customerId: z.string(),
    valid: z.boolean(),
    rejectionReason: z.string().optional(),
    piiDetected: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    const { ticketContent, customerId } = inputData;

    // Length validation
    if (ticketContent.length < 10 || ticketContent.length > 5000) {
      return {
        ticketContent,
        customerId,
        valid: false,
        rejectionReason: `Ticket length invalid: ${ticketContent.length} characters. Must be 10-5000.`,
        piiDetected: false,
      };
    }

    // Customer ID format check
    if (!/^C\d{3,}$/.test(customerId)) {
      return {
        ticketContent,
        customerId,
        valid: false,
        rejectionReason: `Invalid customer ID format: ${customerId}. Expected format: C001`,
        piiDetected: false,
      };
    }

    // Prompt injection detection
    const injectionPatterns = [
      /ignore\s+(previous|all|above)\s+instructions/i,
      /you\s+are\s+now\s+a/i,
      /forget\s+(everything|all|previous)/i,
      /new\s+instructions?:/i,
      /system\s+prompt/i,
      /\[INST\]/i,
      /<<SYS>>/i,
      /approve\s+all\s+refunds/i,
    ];

    const injectionDetected = injectionPatterns.some((pattern) =>
      pattern.test(ticketContent)
    );

    if (injectionDetected) {
      return {
        ticketContent,
        customerId,
        valid: false,
        rejectionReason:
          "Security: Potential prompt injection detected. Ticket rejected.",
        piiDetected: false,
      };
    }

    // PII detection (log but don't block)
    const piiPatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card
      /\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/, // Phone
    ];

    const piiDetected = piiPatterns.some((pattern) =>
      pattern.test(ticketContent)
    );

    if (piiDetected) {
      console.warn(
        `[SECURITY] PII detected in ticket for customer ${customerId}`
      );
    }

    return {
      ticketContent,
      customerId,
      valid: true,
      piiDetected,
    };
  },
});

// ─── Step 1: Triage ───────────────────────────────────────────────────────────

const triageStep = createStep({
  id: "triage",
  description: "Classify the support ticket using the triage agent",
  inputSchema: z.object({
    ticketContent: z.string(),
    customerId: z.string(),
    valid: z.boolean(),
    rejectionReason: z.string().optional(),
    piiDetected: z.boolean(),
  }),
  outputSchema: z.object({
    category: z.enum(["billing", "technical", "account"]),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    summary: z.string(),
    reasoning: z.string(),
    ticketContent: z.string(),
    customerId: z.string(),
    valid: z.boolean(),
    rejectionReason: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    // Short-circuit if validation failed
    if (!inputData.valid) {
      return {
        category: "billing" as const,
        priority: "low" as const,
        summary: "REJECTED",
        reasoning: inputData.rejectionReason || "Validation failed",
        ticketContent: inputData.ticketContent,
        customerId: inputData.customerId,
        valid: false,
        rejectionReason: inputData.rejectionReason,
      };
    }

    const result = await triageAgent.generate(
      `Classify this support ticket for customer ${inputData.customerId}:\n\n${inputData.ticketContent}`,
      {}
    );

    let parsed: z.infer<typeof triageOutputSchema>;
    try {
      const text = result.text.trim();
      parsed = JSON.parse(text);
    } catch {
      // Fallback if JSON parsing fails
      parsed = {
        category: "billing",
        priority: "medium",
        summary: "Could not parse triage response",
        reasoning: result.text,
      };
    }

    return {
      ...parsed,
      ticketContent: inputData.ticketContent,
      customerId: inputData.customerId,
      valid: true,
    };
  },
});

// ─── Step 2: Specialist Routing ───────────────────────────────────────────────

const specialistStep = createStep({
  id: "specialist",
  description: "Route to the appropriate specialist agent",
  inputSchema: z.object({
    category: z.enum(["billing", "technical", "account"]),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    summary: z.string(),
    reasoning: z.string(),
    ticketContent: z.string(),
    customerId: z.string(),
    valid: z.boolean(),
    rejectionReason: z.string().optional(),
  }),
  outputSchema: z.object({
    response: z.string(),
    action: z.enum([
      "refund",
      "escalate",
      "resolved",
      "info_needed",
      "rejected",
    ]),
    refundAmount: z.number().nullable().optional(),
    orderId: z.string().nullable().optional(),
    customerId: z.string(),
    reason: z.string(),
    category: z.enum(["billing", "technical", "account"]),
    priority: z.enum(["low", "medium", "high", "urgent"]),
  }),
  execute: async ({ inputData }) => {
    // Short-circuit if validation failed
    if (!inputData.valid) {
      return {
        response: `Ticket rejected: ${inputData.rejectionReason}`,
        action: "rejected" as const,
        refundAmount: null,
        orderId: null,
        customerId: inputData.customerId,
        reason: inputData.rejectionReason || "Validation failed",
        category: inputData.category,
        priority: inputData.priority,
      };
    }

    const prompt = `Customer ID: ${inputData.customerId}\nTicket: ${inputData.ticketContent}\nSummary: ${inputData.summary}`;
    let parsed: z.infer<typeof specialistOutputSchema>;

    const generateSpecialist = async () => {
      let result;
      if (inputData.category === "billing") {
        result = await billingAgent.generate(prompt);
      } else if (inputData.category === "technical") {
        result = await technicalAgent.generate(prompt);
      } else {
        result = await accountAgent.generate(prompt);
      }
      return JSON.parse(result.text.trim()) as z.infer<
        typeof specialistOutputSchema
      >;
    };

    try {
      parsed = await generateSpecialist();

      // Billing refund requests: if agent didn't return refund data, retry once
      if (
        inputData.category === "billing" &&
        inputData.summary.toLowerCase().includes("refund") &&
        (!parsed.refundAmount || !parsed.orderId)
      ) {
        parsed = await generateSpecialist();
      }
    } catch (err) {
      parsed = {
        response:
          "Specialist agent encountered an error. Escalating to human support.",
        action: "escalate",
        refundAmount: null,
        orderId: null,
        customerId: inputData.customerId,
        reason: String(err),
      };
    }

    // If the agent found a refund amount and order, ensure action is "refund"
    const action =
      parsed.refundAmount && parsed.orderId
        ? ("refund" as const)
        : parsed.action;

    return {
      ...parsed,
      action,
      customerId: parsed.customerId ?? inputData.customerId,
      category: inputData.category,
      priority: inputData.priority,
    };
  },
});

// ─── Step 3: Refund Approval (HITL) ──────────────────────────────────────────

const refundApprovalStep = createStep({
  id: "refund-approval",
  description: "Human-in-the-loop approval for refunds over $50",
  inputSchema: z.object({
    response: z.string(),
    action: z.enum([
      "refund",
      "escalate",
      "resolved",
      "info_needed",
      "rejected",
    ]),
    refundAmount: z.number().nullable().optional(),
    orderId: z.string().nullable().optional(),
    customerId: z.string(),
    reason: z.string(),
    category: z.enum(["billing", "technical", "account"]),
    priority: z.enum(["low", "medium", "high", "urgent"]),
  }),
  outputSchema: z.object({
    finalResponse: z.string(),
    action: z.string(),
    refundProcessed: z.boolean(),
    refundId: z.string().optional(),
    managerApproval: z.boolean().optional(),
    managerNote: z.string().optional(),
  }),
  resumeSchema: z.object({
    approved: z.boolean().optional().default(false),
    managerNote: z.string().optional(),
  }),
  suspendSchema: z.object({
    message: z.string(),
    refundAmount: z.number(),
    orderId: z.string(),
    customerId: z.string(),
    agentRecommendation: z.string(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    const { action, refundAmount, orderId, customerId, response, reason } =
      inputData;

    // Not a refund action — return as-is
    if (action !== "refund" || !refundAmount || !orderId) {
      return {
        finalResponse: response,
        action,
        refundProcessed: false,
      };
    }

    // Auto-approve small refunds (<= $50)
    if (refundAmount <= 50) {
      const refundResult = await processRefund({
        orderId,
        amount: refundAmount,
        reason,
      });

      return {
        finalResponse: `${response}\n\nRefund of $${refundAmount} auto-approved and processed. Refund ID: ${refundResult.refundId}`,
        action: "refund-auto-approved",
        refundProcessed: true,
        refundId: refundResult.refundId,
        managerApproval: false,
      };
    }

    // Large refund (> $50) — requires human approval
    if (!resumeData) {
      await suspend({
        message: `Refund of $${refundAmount} requires manager approval`,
        refundAmount,
        orderId,
        customerId,
        agentRecommendation: reason,
      });
      // Execution pauses here until resume
      return {
        finalResponse: "Suspended: awaiting manager approval",
        action: "suspended",
        refundProcessed: false,
      };
    }

    // Resumed with manager decision
    const { approved, managerNote } = resumeData;

    if (!approved) {
      return {
        finalResponse: `${response}\n\nRefund of $${refundAmount} was declined by manager. Note: ${managerNote || "No note provided."}`,
        action: "refund-declined",
        refundProcessed: false,
        managerApproval: false,
        managerNote,
      };
    }

    const refundResult = await processRefund({
      orderId,
      amount: refundAmount,
      reason,
    });

    return {
      finalResponse: `${response}\n\nRefund of $${refundAmount} approved by manager and processed. Refund ID: ${refundResult.refundId}. Note: ${managerNote || "Approved."}`,
      action: "refund-approved",
      refundProcessed: true,
      refundId: refundResult.refundId,
      managerApproval: true,
      managerNote,
    };
  },
});

// ─── Workflow Assembly ────────────────────────────────────────────────────────

export const supportWorkflow = createWorkflow({
  id: "customer-support-workflow",
  description:
    "Full customer support escalation workflow with guardrails, triage, specialist routing, and HITL",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    finalResponse: z.string(),
    action: z.string(),
    refundProcessed: z.boolean(),
    refundId: z.string().optional(),
    managerApproval: z.boolean().optional(),
    managerNote: z.string().optional(),
  }),
})
  .then(validateTicketStep)
  .then(triageStep)
  .then(specialistStep)
  .then(refundApprovalStep)
  .commit();
