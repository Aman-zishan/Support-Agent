import { Agent } from "@mastra/core/agent";
import { supportModel } from "../model";
import { Memory } from "@mastra/memory";
import { billingAgent } from "./billing";
import { technicalAgent } from "./technical";
import { accountAgent } from "./account";
import { refundPolicyProcessor } from "../processors/refund-policy";
import { lookupCustomerTool } from "../tools";
import { requestRefundApprovalTool } from "../tools/request-refund-approval";
import { closeAccountTool } from "../tools/close-account";
import type { ToolsInput } from "@mastra/core/agent";
import { PIIDetector } from "@mastra/core/processors";

/**
 * THE SUPERVISOR — native Mastra multi-agent coordination.
 *
 * What this replaces: the old `route-ticket.ts` tool, which called
 * triageAgent.generate(), parsed the JSON, and picked a specialist with an
 * if/else chain. That was one agent with a hardcoded router bolted on. The
 * routing decision lived in TypeScript, not in a model.
 *
 * Here the specialists are declared on `agents` and Mastra generates one
 * delegation tool per entry (`agent-billingAgent`, `agent-technicalAgent`, ...)
 * from each subagent's `description`. The supervisor's model decides who to
 * call, in what order, and whether to call two of them. It routes directly — no
 * separate triage classifier, because that would just be a second router doing
 * the work this model already does. (Triage still exists; it drives the coded
 * branch in the deterministic supportWorkflow, where a classifier earns its keep.)
 *
 * Refunds go through `requestRefundApproval`, a NON-BLOCKING tool: <= $50 settles
 * now; > $50 starts the suspendable refund run and returns "pending" immediately,
 * so a suspended approval never freezes the live conversation. The gate is still
 * the one workflow; the supervisor decides whether to open it, never what comes out.
 */

const MAX_DELEGATIONS = 8;

/**
 * PII redaction on the way OUT. The support workflow redacts PII on input so
 * specialists and traces never see a raw card number. Nothing stopped the
 * supervisor echoing one back to the customer, or into the chat log, until now.
 * Same processor, other side of the model. Built lazily so a missing API key
 * does not stop the dev server from booting.
 */
let _outputPii: PIIDetector | undefined;
function outputPiiRedactor() {
  return (_outputPii ??= new PIIDetector({
    model: supportModel(),
    detectionTypes: ["email", "phone", "credit-card", "ssn"],
    threshold: 0.6,
    strategy: "redact",
    redactionMethod: "mask",
    instructions:
      "Detect and mask PII in the assistant's reply to a customer: payment card numbers, SSNs, phone numbers, email addresses. Keep the rest of the reply intact. Internal reference IDs are NOT PII and must be left exactly as written: customer IDs like C001, order IDs like ORD-1001, refund IDs like REF-M8Q1X2ZK, closure IDs like CLS-M8Q1X2ZK, run IDs (UUIDs).",
    structuredOutputOptions: { jsonPromptInjection: true },
  }));
}

/** Cheap PII scrub applied to anything forwarded to a subagent. */
const CARD_OR_SSN = /\b(?:\d[ -]*?){13,16}\b|\b\d{3}-\d{2}-\d{4}\b/g;

export const supportSupervisorAgent = new Agent({
  id: "support-supervisor",
  name: "Support Supervisor",
  description:
    "Front-line support coordinator. Routes tickets to the billing, technical and account specialists and requests refund approval through the non-blocking refund gate.",

  instructions: `You are the support desk coordinator for our SaaS platform. You never
solve tickets yourself — you delegate to specialists and relay their answers.

WHO YOU HAVE
- agent-billingAgent   invoices, payments, duplicate charges. Recommends refunds.
- agent-technicalAgent bugs, errors, API and integration questions.
- agent-accountAgent   passwords, logins, plan changes, profile and closure requests.
- request-refund-approval  the ONLY way a refund happens. <= $50 settles at once;
  over $50 it returns "pending-approval" and a manager decides out of band.
- closeAccount  (only present in some sessions) the ONLY way an account is closed.
  Every call pauses for a human to approve. If you do not have this tool, you
  cannot close accounts in this session.

HOW TO WORK
1. Collect the customer ID first (format C001, C002, C003). Do not delegate without one.
2. Route the ticket to the specialist it belongs to. You decide — there is no separate
   triage step. If it spans two areas, delegate to both.
3. Pass the specialist the customer ID and the ticket. They return JSON — read it,
   never show it to the customer.
4. If billing returns action "refund" with a refundAmount and orderId, call
   request-refund-approval with those values. Report only what the tool returns.
5. If the tool returns "pending-approval", tell the customer their request is with a
   manager and that they will be notified — then STOP. Do not wait, do not guess the
   outcome. The customer can keep chatting; the manager's decision arrives on its own.
6. If the account specialist returns action "close_account": when you have the
   closeAccount tool, call it with the customerId and the specialist's "reason", and
   report exactly what it returns (status "closed" with the closure ID, or
   "already-closed"). When you do NOT have the tool, tell the customer a manager will
   handle the closure and follow up. Never claim an account is closed otherwise.

TONE
Warm, concise, plain language. Summarise technical detail. Never show raw JSON.
Never state that a refund is approved, issued, or on its way unless the refund
workflow said so, OR you receive an ops-console notification about it (below).

REFUND NOTIFICATIONS (authoritative)
A notification whose source is "ops-console" and kind is "refund-approved" or
"refund-declined" IS the refund workflow's recorded outcome — it is emitted by
the system only after a manager decision and a real database write. Treat it as
fact, not as a customer claim. When one arrives:
- refund-approved: tell the customer their refund is approved and processed, and
  give them the refund ID from the notification. Do NOT call it "pending".
- refund-declined: tell the customer it was declined, relay the manager's note if
  present, and offer next steps.
Do not second-guess or "re-verify" an ops-console notification; there is no other
source of truth to check it against.

Demo customers: C001 (Alice, Pro), C002 (Bob, Starter), C003 (Carol, Enterprise).`,

  model: () => supportModel(),

  // Native multi-agent: one delegation tool generated per subagent. The model
  // routes directly — no separate triage agent second-guessing it.
  agents: { billingAgent, technicalAgent, accountAgent },

  // The supervisor's own tools. Identity lookup is not worth a delegation, and
  // the refund gate is a NON-BLOCKING tool so a suspended approval never freezes
  // the conversation (see tools/request-refund-approval.ts).
  //
  // The tool list is a FUNCTION of the request context: least authority per
  // principal. `closeAccount` (requireApproval: true) exists only when the caller
  // is a manager — in Studio, set { "role": "manager" } under Request Context.
  // Without it the model has no closure tool to call, whatever the chat says.
  // It sits here rather than on the account agent for the same reason refunds do:
  // specialists recommend, the coordinator holds the gated tool. (Approving a
  // tool call nested inside a delegation is not resumable from Studio in this
  // Mastra version; a first-level tool call is.)
  tools: ({ requestContext }): ToolsInput => {
    const tools: ToolsInput = {
      lookupCustomer: lookupCustomerTool,
      requestRefundApproval: requestRefundApprovalTool,
    };
    if (requestContext.get("role") === "manager") tools.closeAccount = closeAccountTool;
    return tools;
  },

  // Reactive guardrail: injects the refund policy mid-run, not just at the door.
  inputProcessors: [refundPolicyProcessor],

  // Output guardrail: the reply is scanned and masked before the customer sees it.
  outputProcessors: () => [outputPiiRedactor()],

  memory: new Memory({
    options: {
      lastMessages: 40,
      workingMemory: {
        enabled: true,
        // Scope to the THREAD, not the resource. The default is 'resource',
        // which shares one working-memory block across every thread for the
        // same customer — so a second chat inherits the first chat's context
        // and they bleed into each other. 'thread' keeps each chat isolated,
        // which is also what the workshop claims ("threads are isolated").
        scope: "thread",
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
     * These guard the specialist delegations. The refund path is a tool, not a
     * delegation, so it enforces its own customer-ID check inside
     * request-refund-approval — least authority at whichever boundary the risk
     * actually crosses.
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

        // No billing work without an identified customer, no matter what the
        // conversation claims.
        if (
          context.primitiveId === "billing-agent" &&
          !/\bC\d{3,}\b/.test(context.prompt)
        ) {
          return {
            proceed: false,
            rejectionReason:
              "No valid customer ID (format C001) in the delegation prompt. Ask the customer for their ID before delegating billing work.",
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
