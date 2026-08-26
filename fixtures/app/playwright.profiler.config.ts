// Verbatim from the docs on `bench.playwright.mjs` — the point being that the
// e2e suite exercises the documented path and not a private one. Short budgets:
// every failure mode that suite provokes is a hang otherwise.
import { profilerConfig } from "@abernier/skills/playwright";

export default profilerConfig({
  // `pnpm run dev`, and the layout lives in that script rather than here: it is
  // the same sentence in the flat repo and in the workspace, and the manifest
  // next to it is the one file that already knows where the app went.
  //
  // `pnpm run`, never a bare `vite`: `profiler.sh` starts both legs by exec'ing
  // Playwright directly, so `node_modules/.bin` is on neither leg's `PATH`.
  command: ({ port }) => `pnpm run dev --port ${port} --strictPort`,
  timeout: 60_000,
  webServer: { timeout: 60_000 },
});
