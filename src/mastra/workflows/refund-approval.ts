import { z } from "zod";
import { processRefund } from "../tools";

/**
 * The refund approval gate, extracted so that BOTH paths reach the same
 * human-in-the-loop primitive:
 *
 *   deterministic path  supportWorkflow  -> refundApprovalStep
 *   agentic path        supportSupervisor -> workflow-refundWorkflow tool
 *
 * Wherever a refund is decided, it is decided here. There is exactly one place
 * in the codebase that can move money, and it always sits behind suspend().
 */

/** Refunds at or below this amount auto-approve. Above it, a human decides. */
export const AUTO_APPROVE_LIMIT = 50;

export const refundDecisionInputSchema = z.object({
  customerId: z.string(),
  orderId: z.string().nullable().optional(),
  refundAmount: z.number().nullable().optional(),
  reason: z.string(),
  /** The specialist's message to the customer, carried through to the final response. */
  agentResponse: z.string(),
});

export const refundDecisionOutputSchema = z.object({
  finalResponse: z.string(),
  action: z.string(),
  refundProcessed: z.boolean(),
  refundId: z.string().optional(),
  managerApproval: z.boolean().optional(),
  managerNote: z.string().optional(),
});

/** What the manager sends back on resume. */
export const refundResumeSchema = z.object({
  approved: z.boolean().optional().default(false),
  managerNote: z.string().optional(),
});

/** What the manager sees while the run is parked. */
export const refundSuspendSchema = z.object({
  message: z.string(),
  refundAmount: z.number(),
  orderId: z.string(),
  customerId: z.string(),
  agentRecommendation: z.string(),
});

/** Matches the `suspend` callback Mastra hands to a workflow step. */
type SuspendFn = (payload: z.infer<typeof refundSuspendSchema>) => unknown;

/**
 * Shared execute body. Returns the decision, suspending for a human when the
 * amount exceeds AUTO_APPROVE_LIMIT and no manager decision has arrived yet.
 */
export async function executeRefundApproval({
  inputData,
  resumeData,
  suspend,
}: {
  inputData: z.infer<typeof refundDecisionInputSchema>;
  resumeData?: z.infer<typeof refundResumeSchema>;
  suspend: SuspendFn;
}): Promise<z.infer<typeof refundDecisionOutputSchema>> {
  const { customerId, orderId, refundAmount, reason, agentResponse } = inputData;

  // Nothing to approve — pass the specialist's answer straight through.
  if (!refundAmount || !orderId) {
    return {
      finalResponse: agentResponse,
      action: "no-refund",
      refundProcessed: false,
    };
  }

  // Blast radius containment: bounded amounts settle without a human.
  if (refundAmount <= AUTO_APPROVE_LIMIT) {
    const result = await processRefund({ orderId, amount: refundAmount, reason });
    return {
      finalResponse: `${agentResponse}\n\n${
        result.created
          ? `Refund of $${refundAmount} auto-approved and processed. Refund ID: ${result.refundId}`
          : result.message
      }`,
      action: result.created ? "refund-auto-approved" : "refund-already-issued",
      refundProcessed: result.success,
      refundId: result.refundId,
      managerApproval: false,
    };
  }

  // Above the limit: park the run and wait for a person.
  if (!resumeData) {
    await suspend({
      message: `Refund of $${refundAmount} requires manager approval`,
      refundAmount,
      orderId,
      customerId,
      agentRecommendation: reason,
    });
    // Execution stops here until resume() is called with a manager decision.
    return {
      finalResponse: "Suspended: awaiting manager approval",
      action: "suspended",
      refundProcessed: false,
    };
  }

  const { approved, managerNote } = resumeData;

  if (!approved) {
    return {
      finalResponse: `${agentResponse}\n\nRefund of $${refundAmount} was declined by manager. Note: ${managerNote || "No note provided."}`,
      action: "refund-declined",
      refundProcessed: false,
      managerApproval: false,
      managerNote,
    };
  }

  const result = await processRefund({
    orderId,
    amount: refundAmount,
    reason,
    // Goes into the refunds row, so the audit trail records WHO decided and why.
    managerNote,
  });
  return {
    finalResponse: `${agentResponse}\n\n${
      result.created
        ? `Refund of $${refundAmount} approved by manager and processed. Refund ID: ${result.refundId}. Note: ${managerNote || "Approved."}`
        : result.message
    }`,
    action: result.created ? "refund-approved" : "refund-already-issued",
    refundProcessed: result.success,
    refundId: result.refundId,
    managerApproval: true,
    managerNote,
  };
}
