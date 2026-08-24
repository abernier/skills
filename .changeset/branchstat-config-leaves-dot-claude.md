---
"@abernier/skills": minor
---

`branchstat` reads its per-repo exclude list from `branchstat.json` at the
repository root, not from `.claude/branchstat.json`.

`.claude/` is Claude Code's own directory, and the convention for plugin config
there — `.claude/<plugin>.local.md` — is per-user, gitignored state. This file is
the opposite: it is tracked, and it states repo-wide facts about what is not
product code, shared by everyone working on the repo. The root of a repo names
the thing rather than its provider — `tsconfig.json`, `vite.config.ts` — so the
file is plain `branchstat.json`, namespaced by neither the plugin nor the vendor.

Nothing else changes: the same `exclude` key, the same defaults, and a repo that
needs no extra excludes still needs no config file at all. `branchstat` buckets a
root `branchstat.json` as config, which it did for the old path already.

BREAKING: move `.claude/branchstat.json` to `branchstat.json` at your repository
root. There is no fallback to the old path — left where it is, the file is
ignored and the breakdown silently runs on the defaults.
