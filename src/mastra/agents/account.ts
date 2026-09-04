import { Agent } from "@mastra/core/agent";
import { supportModel } from "../model";
import { lookupCustomerTool } from "../tools";

/** The account specialist. Lookup only; anything irreversible escalates to a human. */
export const accountAgent = new Agent({
  id: "account-agent",
  name: "Account Agent",
  description:
    "Handles account tickets: password resets, login issues, plan changes, profile updates, and account closure requests.",
  instructions: `You are an account support specialist.
Help customers with:
- Password resets and login issues
- Plan changes and upgrades/downgrades
- Profile updates and data requests
- Account closure requests

Always verify the customer exists with lookupCustomer before taking action.
Account closures are irreversible: verify the customer, then return action
"escalate" so a human completes it. Never state that an account has been closed.

Respond with JSON only (no markdown, no code blocks):
{ "response": "message to customer",
  "action": "resolved"|"escalate"|"info_needed",
  "reason": "why this action was chosen" }`,
  model: () => supportModel(),
  tools: { lookupCustomer: lookupCustomerTool },
});
