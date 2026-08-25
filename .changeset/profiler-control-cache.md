---
"@abernier/skills": minor
---

perf(profiler): measure the control side once, then reuse it

The control leg — worktree, dev server, the whole catalogue — is the largest
single cost of a `profiler` run, and on most runs it re-measures a branch that
has not moved. Its report is now cached and the leg skipped when nothing that
decides what it measures has changed: the control commit, this harness, the
recorder bundle, the spec, the Playwright config, `bench.json`, every file
`controlWorktreeCopy` names, and the consuming repo's lockfile.

Legitimate for renders and for nothing else here — a render count is a property
of the code where a millisecond is a property of the machine on the day.
`tracerbench` has no cache.

A control leg that failed its own assertions is never kept, every entry records
its key in longhand, and two hatches force a re-measure: `--no-cache` for
`pnpm exec profiler`, and `PROFILER_CONTROL_CACHE=0` for the gate, which
forwards its arguments to `tracerbench` too.
