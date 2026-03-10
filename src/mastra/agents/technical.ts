import { Agent } from "@mastra/core/agent";
import { google } from "@ai-sdk/google";
import { lookupCustomerTool } from "../tools";

export const technicalAgent = new Agent({
  id: "technical-agent",
  name: "Technical Agent",
  instructions: `You are a technical support specialist.
Help customers with bugs, errors, API questions, and integration issues.
Check the customer plan and features to confirm they have access.
Provide clear step-by-step solutions.

Respond with JSON only (no markdown, no code blocks):
{ "response": "message to customer",
  "action": "resolved"|"escalate"|"info_needed",
  "reason": "why this action was chosen" }`,
  model: google("gemini-2.0-flash"),
  tools: { lookupCustomer: lookupCustomerTool },
});
