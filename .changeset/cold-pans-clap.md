---
"@abernier/skills": patch
---

Bench harness: four `bin` entries, a vitest plugin, and two ways the harness
could address the wrong repository.

- `tracerbench`, `profiler`, `tracerbench-compare` and `profiler-compare` are
  `bin` entries, so a consumer writes the name instead of a path into
  `node_modules`. Each resolves `BASH_SOURCE` through `realpath` first: `bin`
  installs a symlink, and an unresolved `dirname` lands in `node_modules/.bin`
  where none of the siblings a bench sources exist. The comparers get a `.sh`
  wrapper rather than an `npx tsx` shebang — the harness runs under the measured
  repo's own pinned `tsx`, never a fetched one.
- `@abernier/skills/vite` exports `benchTests()`, which collects
  `profiler-compare.test.ts` as a vitest project. It replaces an `include` and a
  narrowed `exclude` a consumer had to write by hand, where forgetting the
  second silently collected nothing.
- `tracerbench.sh`, `profiler.sh` and `lgtm-perf.sh` drop every variable
  `git rev-parse --local-env-vars` names before resolving the repository. Under
  a git hook `GIT_DIR` is inherited and wins over both `cwd` and `-C`, so
  `--show-toplevel` answered with the cwd, the bench lock landed in the hook's
  repository and `git worktree add` checked the control branch out of it.
- `profiler.sh` copies `e2e/gestures.ts` into the control worktree only when the
  repo has one. It is the application's file, not the harness's, and an
  unconditional `cp` killed the run under `set -e` for any repo without it.
