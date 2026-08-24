---
"@abernier/skills": minor
---

The Playwright wiring becomes an interface: `@abernier/skills/playwright`

`tracerbenchConfig()` and `profilerConfig()` build the two configs the benches
run under, so the eight environment variables the harness exports — `TB_PORT`,
`TB_DIST`, `TB_OUTPUT_DIR`, `TB_COUNTERS`, `PLAYWRIGHT_JSON_OUTPUT_FILE`,
`PROFILER_PORT`, `PROFILER_COMMITS`, `PROFILER_SCAN_BUNDLE` — are written down
in the package that sets them instead of being rediscovered by each consumer.

A consumer passes what only its repo knows: the dev-server `command`, and a
`timeout` when two minutes is not enough. Port and base URL derivation,
`testDir`, `testMatch`, `workers`, `outputDir`, the `list` + `json` reporter
pair, `use.trace`, `webServer.url` / `reuseExistingServer` and the profiler's
`globalSetup: "@abernier/skills/profiler-scan"` all move behind it.

BREAKING: `@playwright/test` is now a peer dependency, `>=1.49`. The configs are
loaded by the consumer's Playwright and must use its copy, so a repo that has
none — or an older one — installs or upgrades it. Nothing else about a
hand-written config stops working; the builders are there to replace it, not to
require replacing it.
