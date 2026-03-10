import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { triageAgent } from "../agents/triage";
import { billingAgent } from "../agents/billing";
import { technicalAgent } from "../agents/technical";
import { accountAgent } from "../agents/account";
import { processRefundTool } from "../tools";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const workflowInputSchema = z.object({
  ticketContent: z.string().min(10).max(5000),
  customerId: z.string(),
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

// ─── Step 1: Triage ───────────────────────────────────────────────────────────

const triageStep = createStep({
  id: "triage",
  description: "Classify the support ticket using the triage agent",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    category: z.enum(["billing", "technical", "account"]),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    summary: z.string(),
    reasoning: z.string(),
    ticketContent: z.string(),
    customerId: z.string(),
  }),
  execute: async ({ inputData }) => {
    const result = await triageAgent.generate(
      `Classify this support ticket for customer ${inputData.customerId}:\n\n${inputData.ticketContent}`,
      { output: "text" }
    );

    let parsed: z.infer<typeof triageOutputSchema>;
    try {
      parsed = JSON.parse(result.text.trim());
    } catch {
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
  }),
  outputSchema: z.object({
    response: z.string(),
    action: z.enum(["refund", "escalate", "resolved", "info_needed"]),
    refundAmount: z.number().nullable().optional(),
    orderId: z.string().nullable().optional(),
    customerId: z.string(),
    reason: z.string(),
    category: z.enum(["billing", "technical", "account"]),
    priority: z.enum(["low", "medium", "high", "urgent"]),
  }),
  execute: async ({ inputData }) => {
    const prompt = `Customer ID: ${inputData.customerId}\nTicket: ${inputData.ticketContent}\nSummary: ${inputData.summary}`;
    let parsed: z.infer<typeof specialistOutputSchema>;

    try {
      let result;
      if (inputData.category === "billing") {
        result = await billingAgent.generate(prompt, { output: "text" });
      } else if (inputData.category === "technical") {
        result = await technicalAgent.generate(prompt, { output: "text" });
      } else {
        result = await accountAgent.generate(prompt, { output: "text" });
      }
      parsed = JSON.parse(result.text.trim());
    } catch (err) {
      parsed = {
        response: "Specialist agent encountered an error. Escalating to human support.",
        action: "escalate",
        refundAmount: null,
        orderId: null,
        customerId: inputData.customerId,
        reason: String(err),
      };
    }

    return {
      ...parsed,
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
    action: z.enum(["refund", "escalate", "resolved", "info_needed"]),
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
    approved: z.boolean(),
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
    const { action, refundAmount, orderId, customerId, response, reason } = inputData;

    if (action !== "refund" || !refundAmount || !orderId) {
      return { finalResponse: response, action, refundProcessed: false };
    }

    // Auto-approve small refunds (<= $50)
    if (refundAmount <= 50) {
      const refundResult = await processRefundTool.execute(
        { orderId, amount: refundAmount, reason },
        undefined
      );
      return {
        finalResponse: `${response}\n\nRefund of $${refundAmount} auto-approved. Refund ID: ${refundResult.refundId}`,
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
      return { finalResponse: "Suspended: awaiting manager approval", action: "suspended", refundProcessed: false };
    }

    const { approved, managerNote } = resumeData;

    if (!approved) {
      return {
        finalResponse: `${response}\n\nRefund declined by manager. Note: ${managerNote || "No note provided."}`,
        action: "refund-declined",
        refundProcessed: false,
        managerApproval: false,
        managerNote,
      };
    }

    const refundResult = await processRefundTool.execute(
      { orderId, amount: refundAmount, reason },
      undefined
    );

    return {
      finalResponse: `${response}\n\nRefund of $${refundAmount} approved and processed. Refund ID: ${refundResult.refundId}. Note: ${managerNote || "Approved."}`,
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
  description: "Customer support workflow with triage, specialist routing, and HITL",
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
  .then(triageStep)
  .then(specialistStep)
  .then(refundApprovalStep)
  .commit();
