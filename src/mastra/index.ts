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
import { Observability, DefaultExporter } from '@mastra/observability';
import { describeModel } from './model';

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
	},
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
