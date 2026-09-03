import { createWorkflow, createStep } from "@mastra/core/workflows";
import {
  executeRefundApproval,
  refundDecisionInputSchema,
  refundDecisionOutputSchema,
  refundResumeSchema,
  refundSuspendSchema,
} from "./refund-approval";

/**
 * The HITL refund gate as a standalone workflow.
 *
 * Registered on the supervisor agent via `workflows: { refundWorkflow }`, which
 * Mastra exposes to the model as a `workflow-refundWorkflow` tool. This is the
 * "Agent -> Tool -> Workflow -> Human -> Resume" placement: the risky action
 * lives inside the workflow step, so approval belongs at that step rather than
 * at the tool call.
 *
 * The supervisor can decide *whether* to open this gate. It can never decide
 * what comes out of it.
 */

const refundApprovalStep = createStep({
  id: "refund-approval",
  description: "Human-in-the-loop approval for refunds over $50",
  inputSchema: refundDecisionInputSchema,
  outputSchema: refundDecisionOutputSchema,
  resumeSchema: refundResumeSchema,
  suspendSchema: refundSuspendSchema,
  execute: async ({ inputData, resumeData, suspend }) =>
    executeRefundApproval({ inputData, resumeData, suspend }),
});

export const refundWorkflow = createWorkflow({
  id: "refund-workflow",
  description:
    "Processes a refund for a customer order. Refunds over $50 suspend for manager approval before any money moves. Call this only after a billing specialist has recommended a specific orderId and refundAmount.",
  inputSchema: refundDecisionInputSchema,
  outputSchema: refundDecisionOutputSchema,
})
  .then(refundApprovalStep)
  .commit();
