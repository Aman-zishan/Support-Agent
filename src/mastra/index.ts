import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { chatRoute } from '@mastra/ai-sdk';
import { triageAgent } from './agents/triage';
import { billingAgent } from './agents/billing';
import { technicalAgent } from './agents/technical';
import { accountAgent } from './agents/account';
import { chatAgent } from './agents/chat';
import { supportWorkflow } from './workflows/support-workflow';
import { Observability, DefaultExporter } from '@mastra/observability';
const storage = new LibSQLStore({
	id: 'support-agent-storage',
	url: 'file:./support.db',
});

export const mastra = new Mastra({
	agents: {
		triageAgent,
		billingAgent,
		technicalAgent,
		accountAgent,
		chatAgent,
	},
	workflows: {
		supportWorkflow,
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
	server: {
		cors: {
			origin: ['http://localhost:5173', 'http://localhost:3000'],
			allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
			allowHeaders: [
				'Content-Type',
				'Authorization',
				'x-mastra-client-type',
			],
			exposeHeaders: ['Content-Length', 'X-Requested-With'],
			credentials: true,
		},
		apiRoutes: [
			chatRoute({
				path: '/chat',
				agent: 'chat-agent',
			}),
		],
	},
});
