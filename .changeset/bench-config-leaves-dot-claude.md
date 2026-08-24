---
"@abernier/skills": minor
---

The bench harness reads its per-repo config from `bench.json` at the repository
root, not from `.claude/bench.json`.

`.claude/` is Claude Code's own directory, and this file was never agent state:
it is committed repo config, read by six plain node/bash bins that run in CI
with no Claude in the loop. An un-namespaced filename sitting inside a
platform's directory reads as a native feature of that platform, which this is
not. The root of a repo names the thing rather than its provider — `tsconfig.json`,
`vite.config.ts` — so the file is plain `bench.json`, namespaced by neither the
plugin nor the vendor.

Nothing else changes: the same keys, the same defaults, and a single-package
repo still needs no config file at all. `branchstat` now buckets a root
`bench.json` as config, which it did for the old path already.

BREAKING: move `.claude/bench.json` to `bench.json` at your repository root.
There is no fallback to the old path — left where it is, the file is ignored and
every bench silently runs on the defaults.
