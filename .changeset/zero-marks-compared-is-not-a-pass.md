---
"@abernier/skills": minor
---

A tracerbench run with no mark to compare no longer reads as a pass.

`v0.8.0` fixed this for the profiler and claimed tracerbench never had it. It
did. Observed twice in the wild — `tilt` and `sizematters` — on `lgtm-perf` runs
that exited 0 and printed `tracerbench : ✅ pass`:

```
❌ The control leg exited 1 — its output above says why.
⏳ Comparing results…
Mark                          Control     Experiment      Delta
Total                             0ms            0ms       0.0%
✅ Total regression 0.0% is within threshold of +25%
⚠️  Step drift: 0 compared, 14 only on experiment, 0 only on control, 0 bailed on one side.
```

`v0.8.0` reasoned that a missing report takes the comparer down and `set -e`
takes the script with it. The report is not missing: Playwright's JSON reporter
writes one even when its `webServer` never starts — `suites: []`, one error. So
the comparer read a valid file, found nothing in common with the experiment,
summed an empty set to `0ms` against `0ms`, and called that within threshold.
`Step drift` reported `0 compared` and framed it as a benign test-id rename.

**This will turn runs red that used to be green**, and that is the point: the
run that goes red is the one that compared nothing. Summing no marks gives
`+0.0%`, which is not a measurement of "no regression" — it is the absence of a
measurement.

- The gate is the size of the compared intersection, not the exit status of a
  leg. A leg can fail an assertion and still have timed every mark; voiding a
  real measurement over that would be a different bug. Zero rows compared is
  reported as `NO DATA`, on the console and in the PR comment, and exits
  non-zero — with no threshold declared too. An absent width says "do not judge
  my numbers"; it never said "do not tell me the bench did not run".
- A mark missing from one side is still drift, and still compared as before.
  The three shapes that are not — a side that timed nothing at all, two sides
  sharing no mark, and every shared mark bailing — are named in the verdict.
- A leg starts against a free port. `vite preview` binds `--strictPort`, and the
  ports only came down in the exit trap, after the comparison — so a leg could
  meet a port a previous run still held and die on
  `http://localhost:4200 is already used`. That is the collision that produced
  the false green. The same sweep now runs immediately before each leg binds.
- `tracerbench.sh` no longer dies at the comparer under `set -e`, so a red run
  still emits the footer naming the commit its numbers belong to.
- The profiler's experiment-only comment no longer reads `Verdict: ✅ PASS`
  under its own `❌ No baseline — nothing was compared` banner. Nothing was
  gated wrongly there; the comment simply contradicted the exit code.
