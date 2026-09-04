/**
 * A one-function indirection so the refund-approval STEP can wake a chat thread
 * without importing the supervisor agent (which would be an import cycle:
 * agent -> tool -> refund-workflow -> refund-approval -> agent).
 *
 * `index.ts` wires the real implementation after the Mastra instance exists.
 * The refund step calls `notifyRefundDecision(...)` on resume; if no notifier is
 * wired (e.g. the deterministic workflow running outside a chat), it is a no-op.
 */
export type RefundDecisionNotice = {
  threadId: string;
  resourceId: string;
  approved: boolean;
  orderId: string;
  amount: number;
  refundId?: string;
  managerNote?: string;
};

let notifier: ((notice: RefundDecisionNotice) => Promise<void>) | null = null;

export function setRefundNotifier(fn: (notice: RefundDecisionNotice) => Promise<void>): void {
  notifier = fn;
}

export async function notifyRefundDecision(notice: RefundDecisionNotice): Promise<void> {
  if (!notifier) return; // no chat to wake (deterministic path, or not wired yet)
  try {
    await notifier(notice);
  } catch (err) {
    // A failed notification must never fail the refund itself.
    console.error("[notifier] failed to wake thread:", err);
  }
}
