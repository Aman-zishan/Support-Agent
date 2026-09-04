import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { closeAccountRecord, findCustomer } from "../db";

/**
 * TOOL-LEVEL human-in-the-loop.
 *
 * `requireApproval: true` makes the agent run pause at the moment the model
 * decides to call this tool. Nothing in `execute` runs until a person approves
 * (Studio shows an approve/decline prompt; in code it is
 * `agent.approveToolCall({ runId })` / `declineToolCall`). Decline, and the
 * model is told the call was refused and carries on without it.
 *
 * Compare with the refund gate, which uses workflow `suspend()`:
 *   - requireApproval  → the risk IS the tool call. Nothing else needs to
 *                        happen between the decision and the action.
 *   - suspend()        → the risk is inside a step that also has to do other
 *                        work (look up the order, check idempotency, write the
 *                        row) and the pause sits in the middle of that.
 *
 * Both are the same shape: recommend → a human decides → execute. Which one
 * you reach for depends on where the risky action lives.
 *
 * `requireApproval` also accepts a function of the input, so "only ask above
 * $X" or "only ask for enterprise customers" is one line.
 */
export const closeAccountTool = createTool({
  id: "close-account",
  description:
    "Permanently close a customer's account. Irreversible. Call only after the account specialist has verified the customer and returned action close_account. A human approves every call.",
  requireApproval: true,
  inputSchema: z.object({
    customerId: z.string().describe("Customer ID, e.g. C002"),
    reason: z.string().describe("The customer's stated reason, in their words"),
  }),
  outputSchema: z.object({
    status: z.enum(["closed", "already-closed", "not-found"]),
    closureId: z.string().optional(),
    message: z.string(),
  }),
  execute: async (input) => {
    const customer = await findCustomer(input.customerId);
    if (!customer) {
      return {
        status: "not-found" as const,
        message: `No customer with ID ${input.customerId}.`,
      };
    }
    // Idempotent: the UNIQUE constraint on account_closures.customer_id means
    // a retried or duplicated call returns the original closure, not a second one.
    const { created, closure } = await closeAccountRecord(input.customerId, input.reason);
    return {
      status: created ? ("closed" as const) : ("already-closed" as const),
      closureId: closure.id,
      message: created
        ? `Account ${input.customerId} (${customer.name}) closed. Closure ID ${closure.id}.`
        : `Account ${input.customerId} was already closed on ${closure.closed_at} (closure ${closure.id}).`,
    };
  },
});
