import { Agent } from "@mastra/core/agent";
import { supportModel } from "../model";
import { Memory } from "@mastra/memory";
import { triageAgent } from "./triage";
import { billingAgent } from "./billing";
import { technicalAgent } from "./technical";
import { accountAgent } from "./account";
import { refundWorkflow } from "../workflows/refund-workflow";
import { refundPolicyProcessor } from "../processors/refund-policy";
import { lookupCustomerTool } from "../tools";

/**
 * THE SUPERVISOR — native Mastra multi-agent coordination.
 *
 * What this replaces: the old `route-ticket.ts` tool, which called
 * triageAgent.generate(), parsed the JSON, and picked a specialist with an
 * if/else chain. That was one agent with a hardcoded router bolted on. The
 * routing decision lived in TypeScript, not in a model, and adding a fifth
 * specialist meant editing the if/else.
 *
 * Here the specialists are declared on `agents` and Mastra generates one
 * delegation tool per entry (`agent-billingAgent`, `agent-technicalAgent`, ...)
 * from each subagent's `description`. The supervisor's model decides who to
 * call, in what order, and whether to call two of them. Adding a specialist is
 * one line.
 *
 * `workflows: { refundWorkflow }` becomes a `workflow-refundWorkflow` tool, so
 * the one action that moves money stays behind the HITL gate. The supervisor
 * decides whether to open that gate; it never decides what comes out.
 */

const MAX_DELEGATIONS = 8;

/** Cheap PII scrub applied to anything forwarded to a subagent. */
const CARD_OR_SSN = /\b(?:\d[ -]*?){13,16}\b|\b\d{3}-\d{2}-\d{4}\b/g;

export const supportSupervisorAgent = new Agent({
  id: "support-supervisor",
  name: "Support Supervisor",
  description:
    "Front-line support coordinator. Delegates to triage and specialist agents and runs the refund approval workflow.",

  instructions: `You are the support desk coordinator for our SaaS platform. You never
solve tickets yourself — you delegate to specialists and relay their answers.

WHO YOU HAVE
- agent-triageAgent    classifies a ticket and sets priority. No tools, takes no action.
- agent-billingAgent   invoices, payments, duplicate charges. Recommends refunds.
- agent-technicalAgent bugs, errors, API and integration questions.
- agent-accountAgent   passwords, logins, plan changes, profile and closure requests.
- workflow-refundWorkflow  the ONLY way a refund happens. Over $50 it pauses for a manager.

HOW TO WORK
1. Collect the customer ID first (format C001, C002, C003). Do not delegate without one.
2. If the right specialist is obvious from the ticket, delegate straight to them.
   If it is ambiguous, or spans two areas, call agent-triageAgent first.
3. Pass the specialist the customer ID and the ticket. They return JSON — read it,
   never show it to the customer.
4. If a billing specialist returns action "refund" with a refundAmount and orderId,
   call workflow-refundWorkflow with those values plus the specialist's response.
   Report only what the workflow returns.
5. If the workflow suspends, tell the customer their request is with a manager.
   Do not guess the outcome.

TONE
Warm, concise, plain language. Summarise technical detail. Never show raw JSON.
Never state that a refund is approved, issued, or on its way unless the refund
workflow said so.

Demo customers: C001 (Alice, Pro), C002 (Bob, Starter), C003 (Carol, Enterprise).`,

  model: () => supportModel(),

  // Native multi-agent: one delegation tool generated per subagent.
  agents: { triageAgent, billingAgent, technicalAgent, accountAgent },

  // The HITL gate, reachable as a tool but still a suspendable workflow.
  workflows: { refundWorkflow },

  // The supervisor's own tool. Verifying identity is not worth a delegation.
  tools: { lookupCustomer: lookupCustomerTool },

  // Reactive guardrail: injects the refund policy mid-run, not just at the door.
  inputProcessors: [refundPolicyProcessor],

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
  <specialistsConsulted></specialistsConsulted>
  <refundStatus></refundStatus>
</customer_context>`,
      },
    },
  }),

  defaultOptions: {
    maxSteps: 12,

    /**
     * Delegation hooks are least-authority enforcement at the delegation
     * boundary. They run in TypeScript, so the supervisor's model cannot talk
     * its way past them — which is the whole point of putting them here rather
     * than in the instructions above.
     *
     * `primitiveType` is 'agent' | 'workflow', so one hook guards both the
     * specialist delegations and the refund workflow.
     */
    delegation: {
      onDelegationStart: async (context) => {
        // Runaway loop guard: a supervisor that keeps re-delegating burns
        // tokens and money. Stop it and make it answer with what it has.
        if (context.iteration > MAX_DELEGATIONS) {
          return {
            proceed: false,
            rejectionReason: `Delegation limit (${MAX_DELEGATIONS}) reached. Summarise what you already have and escalate to a human.`,
          };
        }

        // No refund may be attempted without an identified customer, no matter
        // what the conversation claims.
        const needsCustomer =
          context.primitiveId === "refund-workflow" ||
          context.primitiveId === "billing-agent";

        if (needsCustomer && !/\bC\d{3,}\b/.test(context.prompt)) {
          return {
            proceed: false,
            rejectionReason:
              "No valid customer ID (format C001) in the delegation prompt. Ask the customer for their ID before delegating billing or refund work.",
          };
        }

        return { proceed: true };
      },

      onDelegationComplete: async (context) => {
        if (context.error) {
          context.bail();
          return {
            feedback: `Delegation to ${context.primitiveId} failed: ${context.error.message}. Escalate this ticket to a human agent.`,
          };
        }

        // A subagent that stops on a tool-calls step returns empty text, which
        // reads to the supervisor as a successful but empty answer. Replace the
        // result text so the supervisor does not report silence as success.
        if (
          context.result.finishReason === "tool-calls" &&
          !context.result.text.trim()
        ) {
          return {
            resultText: `${context.primitiveId} ran its tools but produced no answer. Re-delegate with a more specific prompt, or escalate.`,
          };
        }
      },

      /**
       * Subagents get the conversation for context — including, potentially, a
       * card number the customer pasted three turns ago. Trim the history and
       * scrub it on the way out.
       */
      messageFilter: ({ messages }) =>
        messages.slice(-10).map((m) => ({
          ...m,
          content: JSON.parse(
            JSON.stringify(m.content).replace(CARD_OR_SSN, "[REDACTED]")
          ),
        })),
    },
  },
});
