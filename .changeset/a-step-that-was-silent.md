---
"@abernier/skills": minor
---

A step that rendered nothing on the control and renders on this branch now
fails the PR.

The per-component gate could not see it. A component with no renders on the
control is classed `new`, and `new` never reaches the blocker tier, which needs
volume on *both* sides. That exemption is right for a component — a PR that adds
one legitimately takes it from 0 to N, and blocking that would redden every
feature — and it is wrong for a step: the catalogue is the same gestures on both
sides, so a gesture that committed nothing and now commits is not a new feature,
it is the same gesture doing new work.

Measured on `tilt`: a `setState` wired to the camera controls' `onChange` took
`zoom` from 0 to 2,937 fiber renders. Every culprit was printed under "Top
component regressions" — `CameraControls 0 → 801 NEW`, `DualCam 0 → 534`,
`CamOverlay 0 → 534` — and the verdict read `✅ PASS — 0 component blockers`.

**This will turn runs red that used to be green.**

- Deliberately only the 0 → N shape. A step that already rendered and renders
  more is ordinary growth, and gating that on a percentage would redden the PR
  that adds a badge to a screen. What this catches is silence, broken.
- `--step-min-renders` (default 20) is the floor, so a step that mounts a
  tooltip does not gate. Both the comparer and `profiler.sh` take it, and it is
  spelled out in the repro command like every other width.
- Codebase components only, like every other actionable number in the comment.
- A step absent from the control is untouched: that is catalogue drift, already
  reported as `(new step)`, and every render in it is new by construction.

`profiler.test.sh` grows both halves — a silent step that starts rendering exits
non-zero and the verdict says which step and why; the same step under the floor
does not gate — and `PROFILER_TEST_KEEP=1` now leaves the fixture repos behind,
because the only way to read a failing case is the run log the teardown used to
delete.
