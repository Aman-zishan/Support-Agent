import type { InputProcessor, ProcessInputStepArgs } from "@mastra/core/processors";

/**
 * A REACTIVE SIGNAL guardrail.
 *
 * The guardrails in support-workflow.ts run once, at the door: they inspect the
 * ticket before any agent sees it and either block it or let it through. That
 * cannot help you on step 7 of an agent loop, when the model has already looked
 * up an order and is about to promise the customer a refund.
 *
 * A reactive signal is injected DURING the run, at the moment a condition holds.
 * The model sees it as another turn in the prompt:
 *
 *   <reactive policy="refund">Never promise a refund...</reactive>
 *
 * `transient: true` means the signal is delivered for this turn only and is
 * never written to storage — so re-sending it each step keeps one fresh copy
 * next to the latest message instead of accumulating ten stale reminders.
 *
 * NOTE: agent signals are marked @experimental in @mastra/core.
 */

const REFUND_TRIGGER = /\brefunds?\b|\brefunded\b|\bmoney back\b|\bchargeback\b/i;

const POLICY_REMINDER = `Refund policy reminder:
- You may never state or imply that a refund has been approved or issued.
- Refunds above $50 require manager approval and are decided by the refund workflow, not by you.
- Report the recommended amount and order ID, then call the refund workflow. Wait for its result before telling the customer anything about outcome or timing.`;

export const refundPolicyProcessor: InputProcessor = {
  id: "refund-policy",
  name: "Refund Policy Reminder",
  description:
    "Injects the refund policy as a reactive signal on any step where refunds are in play.",

  async processInputStep({ messageList, sendSignal }: ProcessInputStepArgs) {
    // No signal transport (e.g. running outside an agent loop) — nothing to do.
    if (!sendSignal) return messageList;

    const recent = messageList.get.all
      .db()
      .slice(-6)
      .map((m) => JSON.stringify(m.content))
      .join(" ");

    if (!REFUND_TRIGGER.test(recent)) return messageList;

    await sendSignal({
      type: "reactive",
      contents: POLICY_REMINDER,
      attributes: { policy: "refund" },
      // Deliver for this turn only; re-sent on the next step if still relevant.
      transient: true,
    });

    return messageList;
  },
};
