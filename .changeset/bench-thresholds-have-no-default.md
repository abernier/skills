---
"@abernier/skills": minor
---

A tracerbench threshold that `bench.json` does not declare is no longer a 20%
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
