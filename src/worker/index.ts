// Worker-mode entry point (optional). Deploys the whole app as a single Worker
// with native cron — used when targeting *.workers.dev instead of Pages.
// The Pages deployment uses functions/api/[[route]].ts + a companion cron Worker.

import app from "./app";
import type { Env } from "./types";
import { runCronCycleAllUsers } from "./services/analysisEngine";

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runCronCycleAllUsers(env)
        .then((summary) => console.log("cron cycle complete:", JSON.stringify(summary)))
        .catch((err) => console.error("cron cycle failed:", err)),
    );
  },
} satisfies ExportedHandler<Env>;
