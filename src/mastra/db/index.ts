import { createClient } from "@libsql/client";

/**
 * The support desk's own SQLite database.
 *
 * Deliberately a SEPARATE file from `support.db`, which Mastra owns for agent
 * memory, workflow snapshots and traces. Two files, two owners:
 *
 *   support.db        Mastra's:  memory, suspended runs, signals, traces
 *   support-data.db   yours:     customers, orders, refunds
 *
 * The tools below do real queries against real rows. That matters for the
 * workshop: an agent whose tools return a hardcoded object literal never shows
 * you what happens when a lookup misses, a write races, or a refund is
 * attempted twice.
 */
export const db = createClient({ url: "file:./support-data.db" });

export type Customer = {
	id: string;
	name: string;
	email: string;
	plan: string;
	since: string;
};

export type Order = {
	id: string;
	customer_id: string;
	amount: number;
	date: string;
	status: string;
	item: string;
};

export type Refund = {
	id: string;
	order_id: string;
	customer_id: string;
	amount: number;
	reason: string;
	manager_note: string | null;
	created_at: string;
};

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS customers (
		id     TEXT PRIMARY KEY,
		name   TEXT NOT NULL,
		email  TEXT NOT NULL,
		plan   TEXT NOT NULL,
		since  TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS orders (
		id          TEXT PRIMARY KEY,
		customer_id TEXT NOT NULL REFERENCES customers(id),
		amount      REAL NOT NULL,
		date        TEXT NOT NULL,
		status      TEXT NOT NULL,
		item        TEXT NOT NULL
	)`,
	/**
	 * The audit trail. Every refund that has ever happened is a row here, and
	 * `order_id` is UNIQUE — the database itself refuses to refund an order
	 * twice, no matter how many times a confused agent retries the call.
	 */
	`CREATE TABLE IF NOT EXISTS refunds (
		id           TEXT PRIMARY KEY,
		order_id     TEXT NOT NULL UNIQUE REFERENCES orders(id),
		customer_id  TEXT NOT NULL,
		amount       REAL NOT NULL,
		reason       TEXT NOT NULL,
		manager_note TEXT,
		created_at   TEXT NOT NULL
	)`,
];

const SEED_CUSTOMERS: Customer[] = [
	{ id: "C001", name: "Alice Johnson", email: "alice@example.com", plan: "pro", since: "2024-03-15" },
	{ id: "C002", name: "Bob Smith", email: "bob@example.com", plan: "starter", since: "2025-01-10" },
	{ id: "C003", name: "Carol Davis", email: "carol@example.com", plan: "enterprise", since: "2023-08-20" },
];

const SEED_ORDERS: Order[] = [
	// C001's duplicate charge — the auto-approve scenario ($49.99 <= $50).
	{ id: "ORD-1001", customer_id: "C001", amount: 49.99, date: "2026-02-15", status: "completed", item: "Pro Plan Monthly" },
	{ id: "ORD-1002", customer_id: "C001", amount: 49.99, date: "2026-02-15", status: "completed", item: "Pro Plan Monthly (duplicate)" },
	{ id: "ORD-2001", customer_id: "C002", amount: 19.99, date: "2026-03-01", status: "completed", item: "Starter Plan Monthly" },
	{ id: "ORD-3001", customer_id: "C003", amount: 299.99, date: "2026-01-15", status: "completed", item: "Enterprise Plan Monthly" },
	// C003's downgrade — the HITL scenario ($897 > $50).
	{ id: "ORD-3002", customer_id: "C003", amount: 897.0, date: "2026-03-01", status: "completed", item: "Enterprise Plan Quarterly (billed after downgrade to Starter)" },
];

let ready: Promise<void> | undefined;

/** Creates the schema and seeds it once per process. Safe to call anywhere. */
export function initDb(): Promise<void> {
	ready ??= (async () => {
		for (const stmt of SCHEMA) await db.execute(stmt);

		const { rows } = await db.execute("SELECT COUNT(*) AS n FROM customers");
		if (Number(rows[0]?.n ?? 0) > 0) return;

		await db.batch(
			[
				...SEED_CUSTOMERS.map((c) => ({
					sql: "INSERT INTO customers (id, name, email, plan, since) VALUES (?, ?, ?, ?, ?)",
					args: [c.id, c.name, c.email, c.plan, c.since],
				})),
				...SEED_ORDERS.map((o) => ({
					sql: "INSERT INTO orders (id, customer_id, amount, date, status, item) VALUES (?, ?, ?, ?, ?, ?)",
					args: [o.id, o.customer_id, o.amount, o.date, o.status, o.item],
				})),
			],
			"write",
		);
	})();
	return ready;
}

export async function findCustomer(id: string): Promise<Customer | null> {
	await initDb();
	const { rows } = await db.execute({
		sql: "SELECT id, name, email, plan, since FROM customers WHERE id = ?",
		args: [id],
	});
	return (rows[0] as unknown as Customer) ?? null;
}

export async function findOrders(customerId: string): Promise<Order[]> {
	await initDb();
	const { rows } = await db.execute({
		sql: "SELECT id, customer_id, amount, date, status, item FROM orders WHERE customer_id = ? ORDER BY date, id",
		args: [customerId],
	});
	return rows as unknown as Order[];
}

export async function findOrder(orderId: string): Promise<Order | null> {
	await initDb();
	const { rows } = await db.execute({
		sql: "SELECT id, customer_id, amount, date, status, item FROM orders WHERE id = ?",
		args: [orderId],
	});
	return (rows[0] as unknown as Order) ?? null;
}

export async function findRefundByOrder(orderId: string): Promise<Refund | null> {
	await initDb();
	const { rows } = await db.execute({
		sql: "SELECT id, order_id, customer_id, amount, reason, manager_note, created_at FROM refunds WHERE order_id = ?",
		args: [orderId],
	});
	return (rows[0] as unknown as Refund) ?? null;
}
