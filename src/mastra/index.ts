import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { triageAgent } from './agents/triage';
import { billingAgent } from './agents/billing';
import { technicalAgent } from './agents/technical';
import { accountAgent } from './agents/account';
import { supportSupervisorAgent } from './agents/supervisor';
import { supportWorkflow } from './workflows/support-workflow';
import { refundWorkflow } from './workflows/refund-workflow';
import { injectionCheckWorkflow } from './workflows/injection-check';
import { injectionVerdictScorer } from './evals/injection-scorer';
import { Observability, DefaultExporter } from '@mastra/observability';
import { describeModel } from './model';
import { setRefundNotifier } from './signals/notifier';

/**
 * Storage is not optional here. It backs three things at once:
 *   - suspended workflow snapshots, so a refund can wait for a manager
 *     across a server restart
 *   - the supervisor's memory and working memory
 *   - the signal + notification inbox (libSQL, Postgres and MongoDB only)
 */
const storage = new LibSQLStore({
	id: 'support-agent-storage',
	url: 'file:./support.db',
});

/**
 * Mastra Studio (http://localhost:4111) is the only UI this project needs:
 * chat with any agent (with threads + memory), run workflows step by step,
 * resume suspended runs, and inspect traces of who delegated to whom.
 */
export const mastra = new Mastra({
	agents: {
		// The coordinator. Delegates to the four below.
		supportSupervisorAgent,
		// Registered individually too, so they stay inspectable on their own
		// in Mastra Studio — useful for the workshop, and for debugging which
		// layer got a delegation wrong.
		triageAgent,
		billingAgent,
		technicalAgent,
		accountAgent,
	},
	workflows: {
		supportWorkflow,
		refundWorkflow,
		// Homework instrument: run the injection detector on one ticket, from Studio.
		injectionCheckWorkflow,
	},
	// Visible under Studio → Scorers. Used by `npm run eval:injection`.
	scorers: { injectionVerdictScorer },
	storage,
	observability: new Observability({
		configs: {
			default: {
				serviceName: 'mastra',
				exporters: [
					new DefaultExporter(), // Persists traces to storage for Mastra Studio
				],
			},
		},
	}),
	logger: new PinoLogger({ name: 'support-system', level: 'info' }),
});

// Make it obvious which provider is live — attendees swap keys mid-workshop.
// Never throws — reports the misconfiguration instead, so the server still boots.
console.log(`[support-system] LLM provider: ${describeModel()}`);

/**
 * Close the HITL loop. When a refund run resumes (manager approved or declined —
 * from Studio's Resume button, or a script), the refund step calls
 * notifyRefundDecision(), which lands here and pushes a NOTIFICATION SIGNAL at
 * the customer's chat thread. The idle supervisor wakes and tells the customer,
 * with no user prompt behind it. This is what makes "approve in Studio -> the
 * agent speaks in the chat" work.
 */
setRefundNotifier(async (n) => {
	const agent = mastra.getAgent('supportSupervisorAgent');
	await agent.sendNotificationSignal(
		{
			source: 'ops-console',
			kind: n.approved ? 'refund-approved' : 'refund-declined',
			priority: 'high',
			summary: n.approved
				? `Refund ${n.refundId ?? ''} for $${n.amount} on ${n.orderId} was APPROVED by a manager.${n.managerNote ? ` Note: ${n.managerNote}` : ''} Tell the customer it is done and share the refund ID.`
				: `Refund for $${n.amount} on ${n.orderId} was DECLINED by a manager.${n.managerNote ? ` Note: ${n.managerNote}` : ''} Tell the customer politely and offer next steps.`,
			payload: { refundId: n.refundId, orderId: n.orderId, amount: n.amount },
			dedupeKey: `refund:${n.refundId ?? n.orderId}`,
		},
		{ threadId: n.threadId, resourceId: n.resourceId, ifIdle: { behavior: 'wake' } },
	);
});
