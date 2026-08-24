---
"@abernier/skills": minor
---

A profiler run that measured only one side no longer reads as a pass.

When the control leg failed to produce a report, `profiler.sh` diffed the
experiment report against itself — every row `0.0% ok` — printed
`✅ PASS — 0 component blockers` and exited 0, so `lgtm-perf` reported
`profiler : ✅ pass`. Two repos verified a release against that green. The
missing *experiment* report took the same route: "cannot proceed", exit 0.

**This will turn runs red that used to be green**, and that is the point: the
run that goes red is the one that never compared anything. Two shapes of it —
a control branch that predates the harness, and a control whose installed
`@abernier/skills` is older than the config copied forward into its worktree
(`ERR_PACKAGE_PATH_NOT_EXPORTED` at config load). Both exit non-zero now.

- A side that produced no report exits non-zero, in strict mode and in soft
  mode alike. Soft is about *regressions* being advisory; it was never about a
  bench that did not run. CI is unaffected in shape: the reusable `perf.yml`
  already runs the bench under `continue-on-error` unless the caller asked for
  `strict`, so a soft run still posts its comment and stays green.
- The experiment-only summary is still emitted — it is the deliverable on the
  PR that introduces the bench to a repo — but its banner now says the run is
  not a pass, and that the deltas are this run diffed against itself.
- Each leg's exit status is reported where it happens, instead of being
  inferred pages later from a missing file. Both benches; `tracerbench.sh`
  never had the false green (a missing report takes its comparer down, and
  `set -e` with it) but reported the failure just as late.
- Under `--strict`, a regression no longer kills `profiler.sh` before the
  footer naming the commit the numbers belong to.
