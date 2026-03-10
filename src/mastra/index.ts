import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { triageAgent } from "./agents/triage";
import { billingAgent } from "./agents/billing";
import { technicalAgent } from "./agents/technical";
import { accountAgent } from "./agents/account";

export const mastra = new Mastra({
  agents: { triageAgent, billingAgent, technicalAgent, accountAgent },
  storage: new LibSQLStore({ id: "support-agent-storage", url: ":memory:" }),
  logger: new PinoLogger({ name: "support-system", level: "info" }),
});
