import { Agent } from "@mastra/core/agent";
import { supportModel } from "../model";
import { lookupCustomerTool } from "../tools";

export const technicalAgent = new Agent({
  id: "technical-agent",
  name: "Technical Agent",
  description:
    "Handles technical tickets: bugs, errors, API questions, and integration issues. Checks the customer plan for feature access and returns step-by-step solutions.",
  instructions: `You are a technical support specialist.
Help customers with bugs, errors, API questions, and integration issues.
Check the customer plan and features to confirm they have access.
Provide clear step-by-step solutions.

Respond with JSON only (no markdown, no code blocks):
{ "response": "message to customer",
  "action": "resolved"|"escalate"|"info_needed",
  "reason": "why this action was chosen" }`,
  model: () => supportModel(),
  tools: { lookupCustomer: lookupCustomerTool },
});
