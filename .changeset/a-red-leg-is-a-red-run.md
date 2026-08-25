---
"@abernier/skills": minor
---

A bench leg that failed its own assertions no longer reads as a pass.

Both specs assert things no threshold can express — `tilt`'s profiler spec
carries a family-B ceiling ("this gesture must not commit React once per
pointer event"), and both specs end red when a mark threw or did not do what it
claims. The leg exited non-zero, the harness printed
`❌ The experiment leg exited 1`, and then dropped that verdict: `STATUS` was
built from the comparer alone. Measured on `tilt` by planting a camera-state
leak — `orbit` went from 2 to 444 React commits, `zoom` 0 → 534, `pan` 0 → 312,
the spec caught all three by name, and `lgtm-perf` printed
`profiler : ✅ pass` and exited 0.

**This will turn runs red that used to be green**, and that is the point: the
run that goes red is the one whose own catalogue said something is wrong.

- The **experiment** leg's exit status gates, in both benches, alongside the
  comparer's verdict rather than instead of it. Nothing stops early — the
  measurement is still worth having, the comment is still written, and a leg
  that failed an assertion still had its marks timed.
- The **control** leg's status deliberately does not gate. It measures the base
  branch, and reddening a PR for what `main` asserts about itself would block
  work on a finding its author cannot fix from there. It is still printed.
- CI keeps its shape: the reusable `perf.yml` runs the bench under
  `continue-on-error` unless the caller asked for `strict`, so a soft run still
  posts its comment and stays green.

`profiler.test.sh` grows the two cases that pin the rule — a failing experiment
leg exits non-zero *while the comparison itself passes*, which is what says the
verdict came from the leg; and a failing control leg does not redden the run.
