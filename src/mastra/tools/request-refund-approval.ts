import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { refundWorkflow } from "../workflows/refund-workflow";

/**
 * NON-BLOCKING refund entry point for the supervisor agent.
 *
 * Why this exists instead of registering `refundWorkflow` as an agent tool:
 * when a suspendable workflow is an inline agent tool and it suspends (> $50),
 * the AGENT run suspends with it — the customer can no longer type. That defeats
 * the entire point of signals, whose job is to keep the conversation alive while
 * a human decides out of band.
 *
 * WHERE THE $50 DECISION LIVES: not here, and never in the prompt. This tool does
 * NOT know the threshold. It starts the refund run and reports what came back:
 *   - the run settled (status 'success')   -> auto-approved / already-issued
 *   - the run suspended                     -> pending-approval, return at once
 * `executeRefundApproval` in workflows/refund-approval.ts owns the <=$50 vs >$50
 * branch. One place, in code, deterministic — the model only decides to CALL the
 * tool, never whether to approve or to suspend.
 *
 * `run.start()` resolves the moment the run hits `suspend()`; it does not wait for
 * a manager. The run is persisted (the workflow is storage-bound by the Mastra
 * instance it is registered on), so a manager later resumes it — in Studio, or
 * `npm run signal:approval` — and a notification signal wakes the thread.
 */
export const requestRefundApprovalTool = createTool({
  id: "request-refund-approval",
  description:
    "Request a refund for a customer order. Refunds of $50 or less settle immediately; larger refunds are queued for manager approval and return status 'pending-approval' WITHOUT waiting — the conversation is never blocked. Call only after a billing specialist has recommended a specific orderId and refundAmount, and only with a valid customer ID.",
  inputSchema: z.object({
    customerId: z.string(),
    orderId: z.string(),
    refundAmount: z.number(),
    reason: z.string(),
  }),
  outputSchema: z.object({
    status: z.enum([
      "auto-approved",
      "pending-approval",
      "already-issued",
      "settled",
      "rejected",
    ]),
    refundId: z.string().optional(),
    runId: z.string().optional(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const { customerId, orderId, refundAmount, reason } = input as {
      customerId: string;
      orderId: string;
      refundAmount: number;
      reason: string;
    };

    // The chat thread that asked for this refund. On resume, the refund step
    // wakes exactly this thread so the agent tells the customer. Undefined when
    // the tool runs outside an agent chat (then the wake is simply skipped).
    const agentCtx = (context as { agent?: { threadId?: string; resourceId?: string } } | undefined)?.agent;
    const notifyThreadId = agentCtx?.threadId;
    const notifyResourceId = agentCtx?.resourceId;

    // Least authority at the tool boundary: no refund without an identified
    // customer, whatever the conversation claims.
    if (!/^C\d{3,}$/.test(customerId)) {
      return {
        status: "rejected" as const,
        message:
          "No valid customer ID (format C001). Ask the customer for their ID before requesting a refund.",
      };
    }

    // Start the one gate. It decides <=$50 vs >$50 in code; we only react to the
    // status. run.start() returns immediately on suspend — it never waits here.
    const run = await refundWorkflow.createRun();
    const res = await run.start({
      inputData: {
        customerId,
        orderId,
        refundAmount,
        reason,
        agentResponse: "Refund escalated for approval.",
        notifyThreadId,
        notifyResourceId,
      },
    });

    if (res.status === "suspended") {
      return {
        status: "pending-approval" as const,
        runId: run.runId,
        message: `Refund of $${refundAmount} on ${orderId} is queued for manager approval (run ${run.runId}). Tell the customer it is with a manager and they will be notified — then stop. Do not promise an outcome.`,
      };
    }

    // Settled without suspending: auto-approved (<=$50) or already issued.
    const result = res.status === "success" ? res.result : undefined;
    const action = result?.action ?? "settled";
    const statusMap: Record<string, "auto-approved" | "already-issued"> = {
      "refund-auto-approved": "auto-approved",
      "refund-already-issued": "already-issued",
    };
    return {
      status: (statusMap[action] ?? "settled") as
        | "auto-approved"
        | "already-issued"
        | "settled",
      refundId: result?.refundId,
      message: result?.finalResponse ?? `Refund run ${run.runId} completed (${action}).`,
    };
  },
});
