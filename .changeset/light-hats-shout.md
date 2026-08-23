---
"@abernier/skills": minor
---

Ship the performance bench harness — `tracerbench`, `profiler` and the
`lgtm-perf` runner — as `scripts/` a repo can depend on by git ref, instead of
each repo carrying its own fork of it.

The scripts now resolve two roots rather than one: the package directory they
live in, for their siblings, and the repository being measured, for everything
else. `lgtm-perf.sh` reads its local gate widths from `.claude/bench.json`
(`thresholds.localTracerbenchMs`, `thresholds.localTracerbenchFrames`) instead
of hard-coding one repo's.
