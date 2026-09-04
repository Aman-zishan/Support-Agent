import { Agent } from "@mastra/core/agent";
import { supportModel } from "../model";
import { lookupCustomerTool } from "../tools";

/**
 * The account specialist. Lookup only.
 *
 * It can VERIFY a customer and RECOMMEND an account closure, but it cannot
 * perform one: `closeAccount` lives on the supervisor, gated by role and by
 * `requireApproval` (see agents/supervisor.ts, tools/close-account.ts). Same
 * shape as refunds — billing recommends, the gate executes. Specialists never
 * hold a destructive tool.
 */
export const accountAgent = new Agent({
  id: "account-agent",
  name: "Account Agent",
  description:
    "Handles account tickets: password resets, login issues, plan changes, profile updates, and account closure requests. Verifies the customer and recommends; cannot close accounts itself.",
  instructions: `You are an account support specialist.
Help customers with:
- Password resets and login issues
- Plan changes and upgrades/downgrades
- Profile updates and data requests
- Account closure requests

Always verify the customer exists with lookupCustomer before taking action.

Account closures: you cannot close accounts. Verify the customer, confirm they
have explicitly asked to close, and return action "close_account" with their
stated reason in "reason". The coordinator holds the closure tool and a human
approves every closure.

Respond with JSON only (no markdown, no code blocks):
{ "response": "message to customer",
  "action": "resolved"|"escalate"|"info_needed"|"close_account",
  "reason": "why this action was chosen, or the customer's stated closure reason" }`,
  model: () => supportModel(),
  tools: { lookupCustomer: lookupCustomerTool },
});
