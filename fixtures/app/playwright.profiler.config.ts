// Verbatim from the docs on `bench.playwright.mjs` — the point being that the
// e2e suite exercises the documented path and not a private one. Short budgets:
// every failure mode that suite provokes is a hang otherwise.
import { profilerConfig } from "@abernier/skills/playwright";

export default profilerConfig({
  // `pnpm run dev`, and the layout lives in that script rather than here.
  //
  // It cannot live in the environment. The two legs do not start the same way:
  // the experiment leg runs `pnpm run test:profiler`, but the control leg execs
  // the worktree's `playwright` binary directly (`profiler.sh`), so anything a
  // `test:profiler` script exports — an env prefix, a `pre` step — reaches the
  // experiment side only. A command the config spells out is spawned by
  // Playwright on both.
  command: ({ port }) => `pnpm run dev --port ${port} --strictPort`,
  timeout: 60_000,
  webServer: { timeout: 60_000 },
});
