import { Agent } from "@mastra/core/agent";
import { google } from "@ai-sdk/google";
import { lookupCustomerTool } from "../tools";

export const accountAgent = new Agent({
  id: "account-agent",
  name: "Account Agent",
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
  model: google("gemini-2.0-flash"),
  tools: { lookupCustomer: lookupCustomerTool },
});
