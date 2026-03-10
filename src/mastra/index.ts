import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";

export const mastra = new Mastra({
  agents: {},
  storage: new LibSQLStore({ id: "support-agent-storage", url: ":memory:" }),
  logger: new PinoLogger({ name: "support-system", level: "info" }),
});
