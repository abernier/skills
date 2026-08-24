// Verbatim from the docs on `bench.playwright.mjs` — the point being that the
// e2e suite exercises the documented path and not a private one. Short budgets:
// every failure mode that suite provokes is a hang otherwise.
import { tracerbenchConfig } from "@abernier/skills/playwright";

export default tracerbenchConfig({
  command: ({ previewArgs }) => `pnpm exec vite preview ${previewArgs}`,
  timeout: 60_000,
  webServer: { timeout: 60_000 },
});
