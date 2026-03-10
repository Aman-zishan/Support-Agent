import { Agent } from "@mastra/core/agent";
import { google } from "@ai-sdk/google";
import { lookupCustomerTool, getOrderHistoryTool } from "../tools";

export const billingAgent = new Agent({
  id: "billing-agent",
  name: "Billing Agent",
  instructions: `You are a billing support specialist.
When handling a refund:
1) Look up customer using their customer ID
2) Check order history for the customer
3) Find duplicate charges or refund-eligible orders
4) Calculate refund amount
5) IMPORTANT: You do NOT process refunds directly. Prepare a recommendation only.

Respond with JSON only (no markdown, no code blocks):
{ "response": "message to customer",
  "action": "refund"|"escalate"|"resolved"|"info_needed",
  "refundAmount": number|null,
  "orderId": string|null,
  "customerId": string|null,
  "reason": string }`,
  model: google("gemini-2.0-flash"),
  tools: {
    lookupCustomer: lookupCustomerTool,
    getOrderHistory: getOrderHistoryTool,
  },
});
