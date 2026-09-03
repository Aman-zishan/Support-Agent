/**
 * SIGNALS DEMO 2 — sendMessage / queueMessage: two people, one agent loop.
 *
 * Run:  npm run signal:multiplayer
 *
 * The problem this solves.
 * -----------------------
 * `agent.stream()` couples two things that are not actually the same: who asked
 * the question, and who owns the stream. Whoever calls stream() gets the
 * response, and nobody else can see it or add to it. So:
 *
 *   - A customer who types a correction while the agent is mid-delegation has
 *     to wait for a wrong answer to finish before they can fix it.
 *   - A human support rep watching the conversation cannot step in.
 *   - The web tab and the mobile app cannot show the same live run.
 *
 * subscribeToThread() decouples them. The thread is the shared object; any
 * number of clients can watch it, and any of them can push context in.
 *
 * The two ways to push differ in urgency:
 *   sendMessage()   interrupt — the ACTIVE run sees it now
 *   queueMessage()  wait      — let the current turn finish, then start a new run
 */
import { randomUUID } from 'node:crypto';
import { mastra } from '../index';

const agent = mastra.getAgent('supportSupervisorAgent');

const thread = {
	threadId: `demo-multiplayer-${randomUUID().slice(0, 8)}`,
	resourceId: 'C001',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
	// ── Client A: a supervisor's dashboard, watching without having asked anything.
	const observer = await agent.subscribeToThread(thread);

	const reader = (async () => {
		for await (const chunk of observer.stream) {
			if (chunk.type === 'text-delta') process.stdout.write(chunk.payload.text);
			if (chunk.type === 'tool-call')
				process.stdout.write(`\n  [delegating: ${chunk.payload.toolName}]\n`);
			if (chunk.type === 'finish') process.stdout.write('\n--- turn end ---\n');
		}
	})();

	// ── Client B: the customer's chat window starts a run.
	console.log('\n[customer] opens with a vague billing complaint\n');
	const run = agent.stream(
		'Customer C001 here. Something looks wrong with my billing this month, can you check?',
		{ memory: { thread: thread.threadId, resource: thread.resourceId } },
	);

	// ── While the supervisor is still delegating to the billing agent, the
	//    customer remembers the detail that actually matters. Interrupt.
	await sleep(2_500);
	console.log('\n\n[customer, mid-run] adds the detail that changes the answer\n');
	agent.sendMessage(
		{
			contents: 'Sorry — it is specifically ORD-1002, I think I was charged twice.',
			// Attributes tell the model WHO is speaking and from where. It sees:
			//   <user name="Alice" sentFrom="web-chat">Sorry — it is ...</user>
			attributes: { name: 'Alice', sentFrom: 'web-chat' },
		},
		thread,
	);

	// ── Client C: a human rep on the same thread, adding context the customer
	//    cannot see. Not urgent — let the current turn land first.
	await sleep(1_000);
	console.log('\n[support rep] queues an internal note for the next turn\n');
	agent.queueMessage(
		{
			contents:
				'Internal note: this customer contacted us about the same duplicate charge last month and it was written off. Be generous.',
			attributes: { name: 'Rep-Jordan', sentFrom: 'internal-console' },
		},
		thread,
	);

	await (await run).text;

	// The queued message starts its own run once the first one finishes.
	await sleep(20_000);

	observer.unsubscribe();
	await reader;
	console.log('\nDone. Three clients, one thread, one conversation history.');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
