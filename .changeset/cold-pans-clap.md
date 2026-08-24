---
"@abernier/skills": patch
---

Bench harness: every program gets a `bin` entry, a vitest plugin replaces a
config a consumer wrote by hand, and two ways the harness could address the
wrong repository.

- `tracerbench`, `profiler`, `lgtm-perf`, `tracerbench-compare`,
  `profiler-compare` and `profiler-aggregate` are `bin` entries, so a consumer
  writes the name instead of a path into `node_modules` — the README no longer
  shows one. Each shell resolves `BASH_SOURCE` through `realpath` first: `bin`
  installs a symlink, and an unresolved `dirname` lands in `node_modules/.bin`
  where none of the siblings a bench sources exist. The three TypeScript
  programs get a `.sh` wrapper rather than an `npx tsx` shebang — the harness
  runs under the measured repo's own pinned `tsx`, never a fetched one.
- A program invoked through its bin now says so. The comparers and the
  aggregator print the name that was typed in their usage message instead of a
  `tsx node_modules/…` path, and the "reproduce locally" line in the sticky PR
  comment reads `pnpm exec profiler --control main --threshold 15`. It used to
  render the resolved script path, which under pnpm is a `node_modules/.pnpm/`
  store directory with the package's git URL encoded into it — correct, and
  useless to the reviewer reading it.
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
