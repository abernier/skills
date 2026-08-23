#!/usr/bin/env bash
# The perf half of the uppercase `LGTM`, as its own script for one reason:
# both harnesses must run even when the first one is red.
#
# Chained with `&&` by its caller, a regression in wall clock would stop the
# re-render harness from ever running — losing half the picture at the exact
# moment it is most wanted. They still run *sequentially*, never in parallel:
# two benchmarks sharing a machine measure each other.
set -uo pipefail

# Two roots, never one — see the header of `tracerbench.sh`. `SCRIPT_DIR` holds
# the two benches this runs; `ROOT_DIR` is the repository they measure, and the
# directory their result files land in.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR" || exit 1

# `bench_config` — the per-repo values, from `.claude/bench.json`. Reads
# `$ROOT_DIR`, so it is sourced after it is set.
# shellcheck source=./_bench-config.sh
source "$SCRIPT_DIR/_bench-config.sh"

# Local thresholds run about twice as tight as CI's, on the grounds that a quiet
# machine deserves a stricter bar — hence a second pair of widths rather than
# the `thresholds.tracerbench*` the benches gate CI with. The defaults are half
# of the benches' own: `--threshold 20` for tracerbench, `--component-threshold
# 30` for the profiler.
#
# Frames is passed only when the config names it. Left out, `tracerbench.sh`
# keeps whatever `thresholds.tracerbenchFrames` gives it, which is the one
# repo-neutral way to say "tighten wall clock and leave frames alone".
LOCAL_MS="$(bench_config thresholds.localTracerbenchMs 10)"
LOCAL_FRAMES="$(bench_config thresholds.localTracerbenchFrames "")"

TRACERBENCH_ARGS=(--threshold "$LOCAL_MS")
if [[ -n "$LOCAL_FRAMES" ]]; then
  TRACERBENCH_ARGS+=(--frames-threshold "$LOCAL_FRAMES")
fi

bash "$SCRIPT_DIR/tracerbench.sh" "${TRACERBENCH_ARGS[@]}" "$@"
tracerbench=$?

bash "$SCRIPT_DIR/profiler.sh" --strict --component-threshold 20 "$@"
profiler=$?

echo ""
echo "──────────────────────────────────────────"
echo "  tracerbench : $([ $tracerbench -eq 0 ] && echo "✅ pass" || echo "❌ fail ($tracerbench)")"
echo "  profiler    : $([ $profiler -eq 0 ] && echo "✅ pass" || echo "❌ fail ($profiler)")"
echo "──────────────────────────────────────────"
echo ""
echo "  tracerbench-results/comment.md"
echo "  profiler-results/comment.md"
echo ""

# A red run is re-run before it is believed: a false red costs a relaunch, a
# false green is silent.
[ $tracerbench -eq 0 ] && [ $profiler -eq 0 ]
