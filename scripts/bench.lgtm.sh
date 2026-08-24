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

# The same scrub as `tracerbench.sh`, for the same reason: GIT_DIR and friends
# win over `cwd` and over `-C`, so under a git hook every git call below would
# answer about the hook's repository instead of the one being measured.
# shellcheck disable=SC2046  # intentional word-splitting of the var-name list
unset $(git rev-parse --local-env-vars)

# `BASH_SOURCE` through `realpath`: the `bin` entry installs this script as a
# symlink in `node_modules/.bin`, and an unresolved `dirname` lands there —
# where none of the siblings sourced below exist.
SCRIPT_DIR="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"
ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR" || exit 1

# `bench_config` — the per-repo values, from `bench.json`. Reads `$ROOT_DIR`,
# so it is sourced after it is set.
# shellcheck source=./bench.config.sh
source "$SCRIPT_DIR/bench.config.sh"

# A quiet machine deserves a stricter bar than CI's, so the local run gets its
# own pair of widths — `thresholds.localTracerbench*` — rather than the
# `thresholds.tracerbench*` the benches gate CI with.
#
# Neither has a default. A width is one repo's calibration on one machine, and
# there is no number this harness could invent that is right for a repo it has
# never measured. Absent, the flag is simply not passed, and `tracerbench.sh`
# keeps whatever `thresholds.tracerbench*` gives it — the repo-neutral way to
# say "tighten wall clock and leave frames alone", or to say nothing at all.
LOCAL_MS="$(bench_config thresholds.localTracerbenchMs "")"
LOCAL_FRAMES="$(bench_config thresholds.localTracerbenchFrames "")"

TRACERBENCH_ARGS=()
if [[ -n "$LOCAL_MS" ]]; then
  TRACERBENCH_ARGS+=(--threshold "$LOCAL_MS")
fi
if [[ -n "$LOCAL_FRAMES" ]]; then
  TRACERBENCH_ARGS+=(--frames-threshold "$LOCAL_FRAMES")
fi

# `${a[@]+"${a[@]}"}` rather than a bare `"${a[@]}"`: under `set -u` bash 3.2 —
# still the system bash on macOS — calls an empty array unbound and dies.
bash "$SCRIPT_DIR/tracerbench.sh" ${TRACERBENCH_ARGS[@]+"${TRACERBENCH_ARGS[@]}"} "$@"
tracerbench=$?

# The profiler's component width is not configurable and does not come from a
# halving: 20 is the value both founding repos calibrated to, carried over as
# it stood. Its bench defaults to 30, which this deliberately tightens — it is
# a third tighter, not half.
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
