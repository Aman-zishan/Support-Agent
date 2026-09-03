import { Agent } from "@mastra/core/agent";
import { supportModel } from "../model";

export const triageAgent = new Agent({
  id: "triage-agent",
  name: "Triage Agent",
  // `description` is what the supervisor's model reads to decide whether to
  // delegate here. Without it, the generated `agent-triage` tool has no
  // description and the supervisor delegates blindly.
  description:
    "Classifies a support ticket into billing, technical, or account, and assigns a priority. Has no tools and takes no action — call this first when the right specialist is not obvious.",
  instructions: `You are a customer support triage agent.
Your job is to classify incoming support tickets into exactly one category:
- "billing" -- invoices, payments, refunds, plan changes, pricing
- "technical" -- bugs, errors, integration help, API questions
- "account" -- password resets, login issues, profile updates, data requests

Respond with JSON only (no markdown, no code blocks):
{ "category": "billing"|"technical"|"account",
  "priority": "low"|"medium"|"high"|"urgent",
  "summary": "Brief one-line summary",
  "reasoning": "Why you classified it this way" }

Rules:
- Refund requests are always "high" priority
- Security concerns are always "urgent"`,
  model: () => supportModel(),
});
