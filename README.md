# WS07: Building Scalable & Secure Multi-Agent AI Systems

**Speaker:** Aman Zishan M A | **Date:** 5 September 2026 | **Duration:** 3 hours
**Framework:** Mastra (TypeScript) | **LLM:** Groq, Anthropic or OpenAI — your choice

A customer support desk built two ways, so you can see the difference. The same four
specialists are coordinated by a **supervisor agent** (the model picks the path) and
by a **workflow** (you fix the path in code) — and both reach the same
human-in-the-loop refund gate.

## Architecture

```
AGENTIC PATH — native multi-agent              DETERMINISTIC PATH — workflow
                                                 
  supportSupervisorAgent                         supportWorkflow
    agents: {                                      1. validate    guardrails, PII
      triageAgent      ─┐                          2. triage      classify + priority
      billingAgent      │ real delegation,         3. specialist  route + resolve
      technicalAgent    │ model-routed             4. refundApproval ─┐
      accountAgent     ─┘                                             │
    }                                                                 │
    workflows: { refundWorkflow } ──────────┐                         │
    delegation: { onDelegationStart,        │                         │
                  onDelegationComplete,     ▼                         ▼
                  messageFilter }        ┌──────────────────────────────┐
    inputProcessors: [refundPolicy]      │  ONE SHARED REFUND GATE      │
                                         │  <= $50   auto-approve       │
                                         │  >  $50   suspend() → human  │
                                         │           → resume()         │
                                         └──────────────┬───────────────┘
                                                        │
                          sendNotificationSignal() ─────┘
                                    │
                     idle thread ───┴──▶ agent wakes, tells the customer
```

`processRefund()` is the only function that moves money. It is a plain function —
on no agent's tool list — called solely from the refund gate.

## Security primitives

| Primitive             | Where it lives                                                    |
| --------------------- | ----------------------------------------------------------------- |
| Least authority       | Billing recommends refunds, cannot issue them. Triage has no tools |
| Blast radius          | Auto-approve bounded at $50                                        |
| Reversibility         | `suspend()` parks the run before anything irreversible             |
| Fail-safe default     | Parse errors, subagent failures and timeouts escalate to a human   |
| Delegation boundary   | `onDelegationStart` rejects risky delegations in TypeScript        |
| PII redaction         | `PIIDetector` at the door + `messageFilter` on every delegation    |
| Prompt injection      | `PromptInjectionDetector` before any agent sees the ticket         |
| **Idempotency**       | `refunds.order_id UNIQUE` — a retried refund is not a second one   |

## Quick start

```bash
git clone <this-repo>
cd support-agent
npm install
cp .env.example .env          # add ONE api key — see below
npm run dev                   # Mastra Studio at http://localhost:4111
```

Requires **Node 22.18+** (some dependencies warn below that).

### Bring your own provider

Set **one** key in `.env` and the project auto-detects it. Nothing else changes —
agents, tools, workflows and delegation are all provider-agnostic, because every
agent resolves its model through `src/mastra/model.ts`.

| Provider  | Env var             | Default model             | Get a key |
| --------- | ------------------- | ------------------------- | --------- |
| Groq      | `GROQ_API_KEY`      | `openai/gpt-oss-120b`     | [console.groq.com](https://console.groq.com) — free tier, fastest |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-opus-5`           | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI    | `OPENAI_API_KEY`    | `gpt-4o`                  | [platform.openai.com](https://platform.openai.com) |

Two optional overrides:

- `MODEL_PROVIDER=groq|anthropic|openai` — required only if you set more than one key
- `MODEL_ID=...` — override the default model (e.g. `claude-haiku-4-5` to cut cost)

The active provider is printed at startup:

```
[support-system] LLM provider: groq / openai/gpt-oss-120b
```

The server boots **without** a key too — Studio, the workflow graph and the
`refundWorkflow` HITL demo all work offline. Only LLM calls need one.

### Signals demos

```bash
npm run signal:approval      # manager approves out-of-band → idle agent wakes and replies
npm run signal:multiplayer   # customer interrupts mid-run; a rep queues an internal note
```

## Data

Two SQLite files, two owners:

| File              | Owner  | Contains                                    |
| ----------------- | ------ | ------------------------------------------- |
| `support.db`      | Mastra | agent memory, suspended runs, signals, traces |
| `support-data.db` | you    | `customers`, `orders`, `refunds`             |

`support-data.db` is created and seeded automatically on first run.

| ID   | Name          | Plan       | Scenario                              |
| ---- | ------------- | ---------- | ------------------------------------- |
| C001 | Alice Johnson | pro        | duplicate charge, $49.99 auto-approve |
| C002 | Bob Smith     | starter    | technical issue, password reset       |
| C003 | Carol Davis   | enterprise | $897 downgrade refund, HITL suspend   |

## Project structure

```
src/mastra/
├── agents/
│   ├── supervisor.ts    # coordinator: subagents + refund workflow + delegation hooks
│   ├── triage.ts        # classifies tickets, zero tools
│   ├── billing.ts       # lookupCustomer + getOrderHistory
│   ├── technical.ts     # lookupCustomer only
│   └── account.ts       # lookupCustomer only
├── db/
│   └── index.ts         # SQLite schema, seed data, queries
├── model.ts             # provider selection — the only file importing an LLM SDK
├── processors/
│   └── refund-policy.ts # reactive-signal guardrail injected mid-run
├── signals/
│   ├── manager-approval.ts  # notification signal wakes an idle thread
│   └── multiplayer.ts       # sendMessage / queueMessage / subscribeToThread
├── tools/
│   └── index.ts         # lookupCustomer, getOrderHistory, processRefund (idempotent)
├── workflows/
│   ├── refund-approval.ts   # the shared HITL decision, one place only
│   ├── refund-workflow.ts   # that gate as a workflow the supervisor can call
│   └── support-workflow.ts  # validate → triage → specialist → refund gate
└── index.ts             # Mastra instance: agents, workflows, storage, /chat route
```

## Test scenarios

See [`instructions.md`](./instructions.md) for the full walkthrough of each scenario
in Mastra Studio.

## Notes

- Agent **signals** require `@mastra/core >= 1.39` and are marked `@experimental`.
  Pin your version.
- Signals need Mastra Memory plus a storage adapter that supports it (libSQL,
  Postgres, MongoDB). Across multiple instances add a Redis pub/sub, or a signal
  sent on one node will never reach the run on another.
