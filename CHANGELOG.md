# @abernier/skills

## 0.5.0

### Minor Changes

- [#13](https://github.com/abernier/skills/pull/13) [`2c49b62`](https://github.com/abernier/skills/commit/2c49b62be2593955b678b8101f4deb268a478172) Thanks [@abernier](https://github.com/abernier)! - The bench harness reads its per-repo config from `bench.json` at the repository
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

- [#19](https://github.com/abernier/skills/pull/19) [`54e7851`](https://github.com/abernier/skills/commit/54e78512e80e8fe52a3695c4788df6d9d3b34649) Thanks [@abernier](https://github.com/abernier)! - A tracerbench threshold that `bench.json` does not declare is no longer a 20%
  gate. It is no gate at all.
  
  A gate width is a calibration of one repo on one machine — `sizematters` runs at
  20/10, `tilt` had to override to 50/30 — so there is no number this harness can
  pick that is right for a repo it has never measured. The old defaults were one
  consumer's calibration reaching every other, and a third repo inherited a 20%
  bar it never chose and could not see. It also contradicted the rule
  `_bench-config.sh` states in its own header: an absent key adds nothing to a
  mechanism rather than turning one on.
  
  So `thresholds.tracerbenchMs`, `thresholds.tracerbenchFrames`,
  `thresholds.localTracerbenchMs` and `thresholds.localTracerbenchFrames` all
  default to nothing. The bench still builds both sides, still measures, still
  writes its comment with every number and delta — it exits 0 without judging, and
  says so: `📊 **NO GATE** — … measured, not judged: no threshold is configured`,
  never a green tick that reads as a bar cleared. `tracerbench.sh` passes
  `--threshold` and `--frames-threshold` to the comparer only when the config named
  a width, and prints what actually gates the run instead of an empty percentage.
  
  The cascade survives. `tracerbenchFrames` still borrows the ms width when it is
  the only one declared, so one number gates both signals; declared alone it gates
  frames alone, and the wall-clock total is reported as `ungated` rather than as
  passing.
  
  `lgtm-perf.sh` also stops claiming its local widths are "half of the benches'
  own". The profiler's `--component-threshold 20` is what both founding repos
  calibrated to against a bench default of 30 — a third tighter, not half — and it
  stays 20. Only the sentence was wrong.
  
  BREAKING: an absent threshold in `bench.json` no longer means a 20% gate, it
  means no gate. Add `"thresholds": { "tracerbenchMs": 20 }` to keep the gate you
  had. No migration.

- [#15](https://github.com/abernier/skills/pull/15) [`31d2845`](https://github.com/abernier/skills/commit/31d2845de8554278133ce8f51334d4a891ed4ab2) Thanks [@abernier](https://github.com/abernier)! - `branchstat` reads its per-repo exclude list from `branchstat.json` at the
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

### Patch Changes

- [#17](https://github.com/abernier/skills/pull/17) [`c4ba95e`](https://github.com/abernier/skills/commit/c4ba95e0db4fa82de2812135f9909308d2788f75) Thanks [@abernier](https://github.com/abernier)! - `branchstat.sh` drops every variable `git rev-parse --local-env-vars` names
  before it resolves the repository, so an inherited `GIT_DIR` can no longer
  redirect the report at another repo.
  
  Git reads `GIT_DIR` and friends out of the environment and lets them win over
  `cwd` — and over `-C`, so no git call in the script could defend itself against
  one. A git hook exports them, which is how a local `/branchstat` run inherits
  one. With `GIT_DIR` set, `ROOT_DIR`, the base and the range were all read out of
  the hook's repository rather than the one the caller stands in: wrong base
  commit, wrong file count, wrong top module. Nothing failed while it happened —
  a report on the wrong repository looks exactly like a report.
  
  It is the same bug class as `d8d9fda`, which scrubbed the bench harness and was
  never carried across to `branchstat`. Every bench bin has carried the scrub
  since; this was the last script in the harness without it. The reusable
  `branchstat` CI workflow was never exposed — a GitHub Actions `run:` step sets
  no `GIT_DIR` — so the only affected path is the local command.
  
  A regression test stands a fixture repo next to a second one with nothing in
  common, points `GIT_DIR` at the second, and pins the report to the first.

## 0.4.2

### Patch Changes

- [#11](https://github.com/abernier/skills/pull/11) [`989ac97`](https://github.com/abernier/skills/commit/989ac97201e642d2d1a833cb94ab11a9e77903f4) Thanks [@abernier](https://github.com/abernier)! - Bench harness: every program gets a `bin` entry, a vitest plugin replaces a
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

## 0.4.1

### Patch Changes

- [#9](https://github.com/abernier/skills/pull/9) [`d8d9fda`](https://github.com/abernier/skills/commit/d8d9fda9494cfda9c1568796fcb355b346aa1d22) Thanks [@abernier](https://github.com/abernier)! - Resolve the repo under test with a scrubbed git environment, so a consumer's
  gate still measures its own tree when it runs from a git hook.
  
  `profiler-compare.test.ts` asks `git rev-parse --show-toplevel` which repository
  it is installed in. That only *discovers* a repository when git does not already
  know which one it is in: a git hook exports `GIT_DIR`, and with it set the
  command answers with the cwd instead. Under `.husky/pre-commit` the answer was
  the package directory inside `node_modules/.pnpm/…`, which has no
  `node_modules/.bin/tsx` — every subprocess came back empty, and the block that
  exists to catch a source tree `.claude/bench.json` has stopped matching skipped
  itself. Measured in a consumer whose gate runs from a hook: the file's 19 tests
  came back 16 failed | 1 passed | 2 skipped; they now all pass, 20 of them with
  the regression test this adds.
  
  The file already built a scrubbed environment for its own `git init`, one bug
  of this same class ago; it is now built first and every git call in the file
  uses it. A test pins the resolution under a worktree-shaped `GIT_DIR`.
  
  No change is needed in a consuming repo.

## 0.4.0

### Minor Changes

- [#7](https://github.com/abernier/skills/pull/7) [`a62d09b`](https://github.com/abernier/skills/commit/a62d09b5b6bbb47525805520b139f73b1769e326) Thanks [@abernier](https://github.com/abernier)! - Run `profiler-aggregate.ts` as a program instead of importing it, and let a
  consumer run `profiler-compare.test.ts` against its own tree.
  
  **Consuming `e2e/profiler.spec.ts` files have to be updated.** The spec no
  longer imports `aggregateCommits` — under `node_modules` that dies at run time
  with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, because Node strips types in
  first-party files only. Drop the import and the fold with it, and write the raw
  commit log instead: one file at `$PROFILER_COMMITS` (default
  `profiler-results/commits.json`), the same report envelope as before, with every
  step carrying the recorder's `commits` where `byComponent` used to be.
  `profiler.sh` then folds each side through the repo's own `tsx`, before the
  diff. The README's bench section spells the shape out, and the CLI refuses a log
  it cannot fold rather than writing the empty aggregate that would read as "no
  regressions".
  
  `profiler-compare.test.ts` now resolves `tsx` and the repo under test from
  `git rev-parse --show-toplevel` rather than from the package directory, so a
  consumer that includes it gets the whole suite — including the block that
  derives a component from the configured `sourceRoots` and catches a source tree
  `.claude/bench.json` has stopped matching. See the README for the vitest
  `include`, and for the `exclude` it has to narrow.

## 0.3.0

### Minor Changes

- [#5](https://github.com/abernier/skills/pull/5) [`eaac659`](https://github.com/abernier/skills/commit/eaac659d787f4c7d98060fe4052a41d9485d9624) Thanks [@abernier](https://github.com/abernier)! - Ship the performance bench harness — `tracerbench`, `profiler` and the
  `lgtm-perf` runner — as `scripts/` a repo can depend on by git ref, instead of
  each repo carrying its own fork of it.
  
  The scripts now resolve two roots rather than one: the package directory they
  live in, for their siblings, and the repository being measured, for everything
  else. `lgtm-perf.sh` reads its local gate widths from `.claude/bench.json`
  (`thresholds.localTracerbenchMs`, `thresholds.localTracerbenchFrames`) instead
  of hard-coding one repo's.

## 0.2.0

### Minor Changes

- [#3](https://github.com/abernier/skills/pull/3) [`3a10ea8`](https://github.com/abernier/skills/commit/3a10ea8aed2b9f62326d2a1fbebdd039aeb64949) Thanks [@abernier](https://github.com/abernier)! - `branchstat` ships as a reusable workflow. A repo that wants the report on every PR calls `abernier/skills/.github/workflows/branchstat.yml` instead of vendoring `branchstat.sh` and a workflow to drive it — the plugin owns branchstat in CI the way it already owns it in a session. The script is read at the ref the caller pinned, so the workflow and the script it runs are never two versions.
  
  Releases are cut with Changesets and tagged `vX.Y.Z` (plus a moving `vX`), which is what a caller pins.
