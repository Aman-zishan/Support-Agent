import { Agent } from "@mastra/core/agent";
import { groq } from "@ai-sdk/groq";
import { Memory } from "@mastra/memory";
import { routeTicketTool } from "../tools/route-ticket";
import { lookupCustomerTool } from "../tools";

export const chatAgent = new Agent({
  id: "chat-agent",
  name: "Customer Support Chat",
  instructions: `You are a friendly and helpful customer support assistant for our SaaS platform.

Your role:
- Greet customers warmly and help them with their issues
- Collect their customer ID if they haven't provided one (format: C001, C002, C003)
- Use the route-ticket tool to handle their support requests — it automatically triages and routes to the right specialist
- Present the specialist's response in a friendly, conversational way (never show raw JSON to the user)
- Use the lookup-customer tool to verify customer identity when needed

Guidelines:
- Be conversational, empathetic, and professional
- If the user hasn't provided a customer ID, ask for it before routing their ticket
- Summarize technical details in plain language
- If an action requires escalation, let the customer know their case is being elevated
- For refund requests, explain the process clearly
- Keep responses concise but helpful

Available demo customers: C001 (Alice, Pro plan), C002 (Bob, Starter plan), C003 (Carol, Enterprise plan)`,
  model: groq("llama-3.3-70b-versatile"),
  memory: new Memory({
    options: {
      lastMessages: 40,
      workingMemory: {
        enabled: true,
        template: `<customer_context>
  <customerId></customerId>
  <name></name>
  <plan></plan>
  <currentIssue></currentIssue>
  <previousActions></previousActions>
</customer_context>`,
      },
    },
  }),
  tools: {
    routeTicket: routeTicketTool,
    lookupCustomer: lookupCustomerTool,
  },
});
