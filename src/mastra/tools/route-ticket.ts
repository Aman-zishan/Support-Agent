import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { triageAgent } from "../agents/triage";
import { billingAgent } from "../agents/billing";
import { technicalAgent } from "../agents/technical";
import { accountAgent } from "../agents/account";

export const routeTicketTool = createTool({
  id: "route-ticket",
  description:
    "Routes a customer support ticket through triage and specialist agents. Use this when the user describes a problem or asks for help with billing, technical issues, or account matters.",
  inputSchema: z.object({
    ticketContent: z.string().describe("The customer's issue or request"),
    customerId: z
      .string()
      .describe("Customer ID (e.g. C001). Use 'unknown' if not provided yet."),
  }),
  outputSchema: z.object({
    category: z.string(),
    priority: z.string(),
    summary: z.string(),
    specialistResponse: z.string(),
    action: z.string(),
    reason: z.string(),
  }),
  execute: async ({ ticketContent, customerId }) => {
    // Step 1: Triage
    const triageResult = await triageAgent.generate(
      `Classify this support ticket for customer ${customerId}:\n\n${ticketContent}`,
      {}
    );

    let triage: {
      category: string;
      priority: string;
      summary: string;
      reasoning: string;
    };
    try {
      triage = JSON.parse(triageResult.text.trim());
    } catch {
      triage = {
        category: "technical",
        priority: "medium",
        summary: "Could not parse triage",
        reasoning: triageResult.text,
      };
    }

    // Step 2: Route to specialist
    const prompt = `Customer ID: ${customerId}\nTicket: ${ticketContent}\nSummary: ${triage.summary}`;
    let specialistText: string;

    try {
      let result;
      if (triage.category === "billing") {
        result = await billingAgent.generate(prompt);
      } else if (triage.category === "technical") {
        result = await technicalAgent.generate(prompt);
      } else {
        result = await accountAgent.generate(prompt);
      }
      specialistText = result.text.trim();
    } catch (err) {
      specialistText = JSON.stringify({
        response: "Specialist encountered an error. Escalating to human support.",
        action: "escalate",
        reason: String(err),
      });
    }

    let specialist: { response: string; action: string; reason: string };
    try {
      specialist = JSON.parse(specialistText);
    } catch {
      specialist = {
        response: specialistText,
        action: "resolved",
        reason: "Parsed as plain text",
      };
    }

    return {
      category: triage.category,
      priority: triage.priority,
      summary: triage.summary,
      specialistResponse: specialist.response,
      action: specialist.action,
      reason: specialist.reason,
    };
  },
});
