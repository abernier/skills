// Verbatim from the docs on `bench.playwright.mjs` — the point being that the
// e2e suite exercises the documented path and not a private one. Short budgets:
// every failure mode that suite provokes is a hang otherwise.
import { tracerbenchConfig } from "@abernier/skills/playwright";

export default tracerbenchConfig({
  // `pnpm run preview`, not `vite preview`: this config is copied unchanged
  // into every layout the suite builds, and where the app is differs between
  // them. A script name is the same sentence in all of them, and the manifest
  // next to it — the flat repo's, the workspace root's — is the one file that
  // already knows where the app went. See the note in the profiler config for
  // why it has to be the command that carries this and not the environment.
  command: ({ previewArgs }) => `pnpm run preview ${previewArgs}`,
  timeout: 60_000,
  webServer: { timeout: 60_000 },
});
