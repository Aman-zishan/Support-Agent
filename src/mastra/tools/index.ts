import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  findCustomer,
  findOrder,
  findOrders,
  findRefundByOrder,
  db,
  initDb,
} from "../db";

/**
 * Tools are the agent's hands. These ones reach a real SQLite database
 * (support-data.db), not an object literal — so a missed lookup, a stale row,
 * or a double-refund attempt behaves the way it would in production.
 */

export const lookupCustomerTool = createTool({
  id: "lookup-customer",
  description: "Look up customer details by customer ID",
  inputSchema: z.object({
    customerId: z.string().describe("Customer ID, e.g. C001"),
  }),
  outputSchema: z.object({
    name: z.string(),
    email: z.string(),
    plan: z.string(),
    since: z.string(),
    found: z.boolean(),
  }),
  execute: async (inputData) => {
    const c = await findCustomer(inputData.customerId);
    if (!c) return { name: "", email: "", plan: "", since: "", found: false };
    return {
      name: c.name,
      email: c.email,
      plan: c.plan,
      since: c.since,
      found: true,
    };
  },
});

export const getOrderHistoryTool = createTool({
  id: "get-order-history",
  description:
    "Get order history for a customer, including whether each order has already been refunded",
  inputSchema: z.object({
    customerId: z.string(),
  }),
  outputSchema: z.object({
    orders: z.array(
      z.object({
        id: z.string(),
        amount: z.number(),
        date: z.string(),
        status: z.string(),
        item: z.string(),
        alreadyRefunded: z.boolean(),
      })
    ),
  }),
  execute: async (inputData) => {
    const orders = await findOrders(inputData.customerId);
    // Tell the agent what has already been refunded. Without this it will
    // happily recommend refunding the same duplicate charge a second time.
    const refunded = await Promise.all(
      orders.map(async (o) => Boolean(await findRefundByOrder(o.id)))
    );
    return {
      orders: orders.map((o, i) => ({
        id: o.id,
        amount: o.amount,
        date: o.date,
        status: o.status,
        item: o.item,
        alreadyRefunded: refunded[i],
      })),
    };
  },
});

/** Convenience read for scripts and workflow steps. Not exposed to any agent. */
export async function getOrders(customerId: string) {
  return findOrders(customerId);
}

type ProcessRefundResult = {
  success: boolean;
  refundId: string;
  message: string;
  /** True when this call created the refund; false when one already existed. */
  created: boolean;
};

/**
 * The only function in this codebase that moves money.
 *
 * It is a plain function, NOT a Mastra tool, and it is not on any agent's tool
 * list. Nothing a model outputs can reach it directly — it is called from the
 * refund-approval step, after the HITL gate.
 *
 * IDEMPOTENT. `refunds.order_id` is UNIQUE, so a retry, a duplicated tool call,
 * or two workers racing the same approval all collapse to one refund. The second
 * caller gets the first caller's refund ID back and `created: false`. This is
 * the database enforcing the invariant, not the agent remembering to.
 */
export async function processRefund(input: {
  orderId: string;
  amount: number;
  reason: string;
  managerNote?: string;
}): Promise<ProcessRefundResult> {
  await initDb();

  const order = await findOrder(input.orderId);
  if (!order) {
    return {
      success: false,
      refundId: "",
      message: `Order ${input.orderId} not found.`,
      created: false,
    };
  }

  const existing = await findRefundByOrder(input.orderId);
  if (existing) {
    return {
      success: true,
      refundId: existing.id,
      message: `Order ${input.orderId} was already refunded on ${existing.created_at} (refund ${existing.id}). No second refund issued.`,
      created: false,
    };
  }

  // Base-36, not a 13-digit run: a long digit string reads as a card number to
  // the output PII redactor, which would mask the refund ID in the reply.
  const refundId = `REF-${Date.now().toString(36).toUpperCase()}`;
  const createdAt = new Date().toISOString();

  try {
    await db.batch(
      [
        {
          sql: `INSERT INTO refunds (id, order_id, customer_id, amount, reason, manager_note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            refundId,
            input.orderId,
            order.customer_id,
            input.amount,
            input.reason,
            input.managerNote ?? null,
            createdAt,
          ],
        },
        {
          sql: "UPDATE orders SET status = 'refunded' WHERE id = ?",
          args: [input.orderId],
        },
      ],
      "write"
    );
  } catch (err) {
    // Lost a race on the UNIQUE constraint — the other caller's refund stands.
    const winner = await findRefundByOrder(input.orderId);
    if (winner) {
      return {
        success: true,
        refundId: winner.id,
        message: `Order ${input.orderId} was refunded concurrently (refund ${winner.id}). No second refund issued.`,
        created: false,
      };
    }
    throw err;
  }

  return {
    success: true,
    refundId,
    message: `Refund of $${input.amount} for ${input.orderId}. Reason: ${input.reason}`,
    created: true,
  };
}
