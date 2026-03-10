import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const customers: Record<
  string,
  { name: string; email: string; plan: string; since: string }
> = {
  C001: {
    name: "Alice Johnson",
    email: "alice@example.com",
    plan: "pro",
    since: "2024-03-15",
  },
  C002: {
    name: "Bob Smith",
    email: "bob@example.com",
    plan: "starter",
    since: "2025-01-10",
  },
  C003: {
    name: "Carol Davis",
    email: "carol@example.com",
    plan: "enterprise",
    since: "2023-08-20",
  },
};

const orders: Record<
  string,
  { id: string; amount: number; date: string; status: string; item: string }[]
> = {
  C001: [
    {
      id: "ORD-1001",
      amount: 49.99,
      date: "2026-02-15",
      status: "completed",
      item: "Pro Plan Monthly",
    },
    {
      id: "ORD-1002",
      amount: 49.99,
      date: "2026-02-15",
      status: "completed",
      item: "Pro Plan Monthly (duplicate)",
    },
  ],
  C002: [
    {
      id: "ORD-2001",
      amount: 19.99,
      date: "2026-03-01",
      status: "completed",
      item: "Starter Plan Monthly",
    },
  ],
  C003: [
    {
      id: "ORD-3001",
      amount: 299.99,
      date: "2026-01-15",
      status: "completed",
      item: "Enterprise Plan Monthly",
    },
    {
      id: "ORD-3002",
      amount: 897.0,
      date: "2026-03-01",
      status: "pending",
      item: "Enterprise Plan (downgrade refund)",
    },
  ],
};

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
    const c = customers[inputData.customerId];
    if (!c) return { name: "", email: "", plan: "", since: "", found: false };
    return { ...c, found: true };
  },
});

export const getOrderHistoryTool = createTool({
  id: "get-order-history",
  description: "Get order history for a customer",
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
      })
    ),
  }),
  execute: async (inputData) => ({
    orders: orders[inputData.customerId] || [],
  }),
});

export const processRefundTool = createTool({
  id: "process-refund",
  description:
    "Process a refund. Use only after human approval for amounts over $50.",
  inputSchema: z.object({
    orderId: z.string(),
    amount: z.number(),
    reason: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    refundId: z.string(),
    message: z.string(),
  }),
  execute: async (inputData) => ({
    success: true,
    refundId: `REF-${Date.now()}`,
    message: `Refund of $${inputData.amount} for ${inputData.orderId}. Reason: ${inputData.reason}`,
  }),
});
