---
"@abernier/skills": minor
---

Run `profiler-aggregate.ts` as a program instead of importing it, and let a
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
