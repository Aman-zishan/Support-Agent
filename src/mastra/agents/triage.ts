import { Agent } from "@mastra/core/agent";
import { supportModel } from "../model";

export const triageAgent = new Agent({
  id: "triage-agent",
  name: "Triage Agent",
  // Not a subagent of the supervisor (the supervisor routes directly). This
  // agent is the classifier behind the deterministic supportWorkflow's triage
  // step. `description` is shown in Studio and, if you ever do register it on
  // an agent's `agents: {}`, becomes the generated delegation tool's description.
  description:
    "Classifies a support ticket into billing, technical, or account, and assigns a priority. Has no tools and takes no action. Used by the support workflow's triage step.",
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
