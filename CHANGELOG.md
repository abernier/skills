# @abernier/skills

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
