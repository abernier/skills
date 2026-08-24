// Verbatim from the docs on `bench.playwright.mjs` — the point being that the
// e2e suite exercises the documented path and not a private one. Short budgets:
// every failure mode that suite provokes is a hang otherwise.
import { profilerConfig } from "@abernier/skills/playwright";

export default profilerConfig({
  command: ({ port }) => `pnpm exec vite --port ${port} --strictPort`,
  timeout: 60_000,
  webServer: { timeout: 60_000 },
});
