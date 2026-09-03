import { Agent } from "@mastra/core/agent";
import { supportModel } from "../model";
import { lookupCustomerTool } from "../tools";

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

Always verify the customer exists before taking action.

Respond with JSON only (no markdown, no code blocks):
{ "response": "message to customer",
  "action": "resolved"|"escalate"|"info_needed",
  "reason": "why this action was chosen" }`,
  model: () => supportModel(),
  tools: { lookupCustomer: lookupCustomerTool },
});
