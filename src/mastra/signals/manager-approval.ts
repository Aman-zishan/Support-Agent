/**
 * SIGNALS DEMO 1 — Notification signals: closing the HITL loop.
 *
 * Run:  npm run signal:approval
 *
 * The problem this solves.
 * -----------------------
 * Our refund workflow suspends and waits for a manager. That is correct, but it
 * leaves the customer conversation dead. The manager approves in some ops console
 * twenty minutes later and nothing tells the customer — because in a
 * request/response world, the only way to make an agent speak is for the customer
 * to speak first.
 *
 * A notification signal reverses that. An external system pushes an event into
 * the thread; Mastra wakes the idle agent and it speaks unprompted.
 *
 *   suspend() ──> [manager decides] ──> resume() ──> real refund
 *                                                        │
 *                          sendNotificationSignal ───────┘
 *                                    │
 *                     [idle thread] ─┴─> wakes ──> agent tells the customer
 *
 * Everything below is read from the run itself. The refund ID is the one
 * processRefund() actually returned — nothing here is invented.
 */
import { randomUUID } from 'node:crypto';
import { mastra } from '../index';
import { getOrders } from '../tools';

const CUSTOMER_ID = 'C003';

const agent = mastra.getAgent('supportSupervisorAgent');
const refundWorkflow = mastra.getWorkflow('refundWorkflow');

const thread = {
	threadId: `demo-approval-${randomUUID().slice(0, 8)}`,
	resourceId: CUSTOMER_ID,
};

async function main() {
	// The order under dispute comes from the seed dataset, not from a literal.
	const pending = (await getOrders(CUSTOMER_ID)).find((o) => o.status === 'pending');
	if (!pending) throw new Error(`No pending order for ${CUSTOMER_ID}`);

	console.log(`\nDisputed order: ${pending.id} — $${pending.amount} (${pending.item})\n`);

	// ── 1. Watch the thread. We are not the one who will start the last run.
	const subscription = await agent.subscribeToThread(thread);
	const reader = (async () => {
		for await (const chunk of subscription.stream) {
			if (chunk.type === 'text-delta') process.stdout.write(chunk.payload.text);
			if (chunk.type === 'finish') process.stdout.write('\n');
		}
	})();

	// ── 2. Customer opens the conversation. The supervisor delegates to billing.
	console.log('[customer] asks about the refund\n');
	const opening = await agent.stream(
		`Hi, this is customer ${CUSTOMER_ID}. I need a refund after my Enterprise plan downgrade — I was charged $${pending.amount} on ${pending.id} but I switched to starter last week.`,
		{ memory: { thread: thread.threadId, resource: thread.resourceId } },
	);
	await opening.text;

	// ── 3. The refund gate. Over $50, so it parks and waits for a person.
	console.log('\n\n[workflow] opening the refund gate\n');
	const run = await refundWorkflow.createRun();
	const suspended = await run.start({
		inputData: {
			customerId: CUSTOMER_ID,
			orderId: pending.id,
			refundAmount: pending.amount,
			reason: 'Enterprise plan downgrade — customer switched to starter mid-cycle.',
			agentResponse: 'I have escalated your refund request to a manager for approval.',
		},
	});

	if (suspended.status !== 'suspended') {
		throw new Error(`Expected the refund to suspend, got: ${suspended.status}`);
	}

	// This is exactly what the manager sees in their queue. Note the two fields:
	//   `suspended`      which step path parked (here: [['refund-approval']])
	//   `suspendPayload` the data the step handed the human to decide on
	console.log(`[manager queue] parked at: ${JSON.stringify(suspended.suspended)}`);
	console.log('[manager queue] suspend payload:');
	console.log(JSON.stringify(suspended.suspendPayload, null, 2));
	console.log('\n[thread idle — nobody is typing]\n');

	// ── 4. The manager approves. THIS is the real HITL resume: processRefund()
	//       runs here, for the first time, and mints a real refund ID.
	console.log('[ops-console] manager approves\n');
	const settled = await run.resume({
		step: 'refund-approval',
		resumeData: {
			approved: true,
			managerNote: 'Legitimate downgrade, verified against plan history.',
		},
	});

	if (settled.status !== 'success') {
		throw new Error(`Resume did not settle: ${settled.status}`);
	}
	const { refundId, refundProcessed } = settled.result;
	console.log(`[workflow] processed=${refundProcessed} refundId=${refundId}\n`);

	// ── 5. Push the real outcome at the idle thread. The ops console knows
	//       nothing about our chat UI; it just emits an event.
	await agent.sendNotificationSignal(
		{
			source: 'ops-console',
			kind: 'refund-approved',
			priority: 'high',
			summary: `Refund ${refundId} for $${pending.amount} on ${pending.id} was approved by the manager. Note: legitimate downgrade, verified against plan history.`,
			payload: { refundId, orderId: pending.id, amount: pending.amount },
			// Same approval delivered twice (retry, double-click) collapses to one.
			dedupeKey: `refund:${refundId}`,
		},
		{
			...thread,
			// Default behaviour wakes an idle thread. ifIdle.behavior:'persist'
			// banks the event silently instead — the right call for low-priority
			// noise you do not want interrupting a customer.
			ifIdle: { behavior: 'wake' },
		},
	);

	// ── 6. The agent wakes on its own and tells the customer. No user turn.
	console.log('[agent wakes, unprompted]\n');
	await new Promise((r) => setTimeout(r, 15_000));

	subscription.unsubscribe();
	await reader;
	console.log('\nDone. The last message had no user prompt behind it.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
