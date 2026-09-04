#!/usr/bin/env node
/**
 * Reset the workshop databases.
 *
 *   npm run db:reset
 *
 * Wipes both SQLite files (and their WAL/SHM sidecars) wherever they live:
 *   support.db        Mastra's: memory, suspended runs, signals, traces
 *   support-data.db   yours:     customers, orders, refunds
 *
 * The app reseeds support-data.db lazily on the next lookup (3 customers, 5
 * orders, 0 refunds), so there is nothing to re-create here. If `npm run dev`
 * is running, restart it so it drops its open handles and picks up the fresh files.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

// The dev server's working directory varies (root vs. the bundled public dir),
// so clear both known locations.
const dirs = [".", "src/mastra/public"];
const bases = ["support.db", "support-data.db"];
const suffixes = ["", "-wal", "-shm"];

let cleared = 0;
for (const dir of dirs) {
  for (const base of bases) {
    for (const suffix of suffixes) {
      const path = join(dir, base + suffix);
      try {
        rmSync(path, { force: true });
        cleared++;
      } catch {
        /* missing file — nothing to do */
      }
    }
  }
}

console.log("✓ Databases reset — support.db and support-data.db wiped.");
console.log("  Next lookup reseeds support-data.db: 3 customers, 5 orders, 0 refunds.");
console.log("  If `npm run dev` is running, restart it to load the fresh files.");
