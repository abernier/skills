#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Local TracerBench — mirrors the CI `tracerbench` job for dev/CI parity.
#
# Usage:
#   pnpm run tracerbench              # compare current branch vs auto-detected base
#                                     # (PR target via gh / $GITHUB_BASE_REF, else main)
#   pnpm run tracerbench -- --control feat/other   # explicit control branch
#   pnpm run tracerbench -- --threshold 30         # custom ms threshold
#   pnpm run tracerbench -- --frames-threshold 15  # custom frames threshold
#
# Used by both `pnpm run tracerbench` locally and the CI `tracerbench` job.
# ──────────────────────────────────────────────────────────────────────────────

# Two roots, never one. `SCRIPT_DIR` is where this harness lives — a directory
# inside the consuming repo's `node_modules`, whose siblings this script sources
# and runs. `ROOT_DIR` is the repository being measured: every git operation,
# `bench.json`, the builds, `node_modules` and its `tsx` are all its.
# Confusing the two produces a plausible wrong number rather than an error.

# Git reads GIT_DIR and friends out of the environment and lets them win over
# `cwd` — and over `-C`, so `git -C "$ROOT_DIR"` is no defence either. A git
# hook exports them, and then `--show-toplevel` answers with the cwd, the bench
# lock lands in the hook's repository and `git worktree add` checks the control
# branch out of it. Everything below must answer about the repo being measured,
# so drop git's own list of repo-local variables once, here, for this script and
# for every child it spawns.
# shellcheck disable=SC2046  # intentional word-splitting of the var-name list
unset $(git rev-parse --local-env-vars)

# `BASH_SOURCE` through `realpath`: the `bin` entry installs this script as a
# symlink in `node_modules/.bin`, and an unresolved `dirname` lands there —
# where none of the siblings sourced below exist.
SCRIPT_DIR="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"
ROOT_DIR="$(git rev-parse --show-toplevel)"

# The command a reader pastes to re-run this.
#
# Named, not spelled out as a path, whenever this was reached through its `bin`
# entry — which is how a repo runs it now. `$0` does not carry that name under
# every package manager (npm symlinks the bin, pnpm execs the real file through
# a shim), so it is recognised by basename instead: `tracerbench` and
# `tracerbench.sh` are the same program, and both print as
# `pnpm exec tracerbench`, which resolves from anywhere in the repo. That is
# the point of the footer — a reader who doubts a number re-runs it without
# reverse-engineering the workflow file — and a `node_modules/.pnpm/…` store
# path in a PR comment is not something anyone pastes.
#
# `pnpm exec`, never `pnpm run … -- --flag`: the latter forwards the literal
# `--` and dies on "Unknown option".
#
# Run under some other name — a vendored copy, a rename — there is no name to
# print, and the footer falls back to `bash <path>`, resolved against the
# invocation cwd *before* the `cd` below and expressed relative to the repo
# root. The scripts live in `node_modules`, so `scripts/tracerbench.sh` is no
# longer their address and nothing here can write it down.
if [[ "$(basename "$0")" == "tracerbench" || "$(basename "$0")" == "tracerbench.sh" ]]; then
  SELF="pnpm exec tracerbench"
else
  SELF="$0"
  [[ "$SELF" == /* ]] || SELF="$PWD/$SELF"
  SELF="bash ${SELF#"$ROOT_DIR"/}"
fi

# Every relative path below is repo-relative by construction, and the comparer
# resolves the repo it filters against from its own cwd.
cd "$ROOT_DIR"

RESULTS_DIR="$ROOT_DIR/tracerbench-results"
# One source of truth: the `TB_PORT` lines below bind these, and the exit trap
# frees them. Experiment takes the odd port one above control, so a leftover
# server from the other side can never be silently reused.
CONTROL_PORT=4200
EXPERIMENT_PORT=4201

# Shared helpers: `default_control`, `emit_comment_footer`, `acquire_bench_lock`,
# `release_bench_lock`, `kill_bench_ports`, `trap_teardown`.
# shellcheck source=./bench.common.sh
source "$SCRIPT_DIR/bench.common.sh"
# `bench_config`, `bench_config_list` — the per-repo values, from `bench.json`.
# shellcheck source=./bench.config.sh
source "$SCRIPT_DIR/bench.config.sh"

# Gate widths are a calibration of this repo on this machine, so they live in
# the config rather than here — see the header of `tracerbench.compare.ts` for
# how to arrive at one. There is no default for the same reason: a width this
# harness invented would be one repo's calibration imposed on every other, and a
# repo that never declared one would go red with no way to see why.
#
# So an absent key means no gate. The bench still builds both sides, still
# measures, still writes its comment — it just does not judge. Empty here, and
# the flag is left off the comparer entirely below; frames borrows the ms width
# there when only that one is declared.
THRESHOLD="$(bench_config thresholds.tracerbenchMs "")"
FRAMES_THRESHOLD="$(bench_config thresholds.tracerbenchFrames "")"
# Where `pnpm run build` leaves the bundle. `dist` in a single-package repo, a
# path inside the app package in a workspace.
DIST_DIR="$(bench_config distDir dist)"
# `TB_DIST` is handed to `vite preview --outDir`, which resolves it against the
# vite root — the directory holding the app — so it is the last segment of
# `DIST_DIR`, never a repo-relative path.
DIST_NAME="$(basename "$DIST_DIR")"

CONTROL_BRANCH="$(default_control)"

# ── Parse arguments ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    # `pnpm run tracerbench -- --control x` forwards the `--` itself, unlike npm.
    # Swallow it, or the documented invocation dies on "Unknown option: --".
    --)         shift ;;
    --control)  CONTROL_BRANCH="$2"; shift 2 ;;
    --threshold) THRESHOLD="$2"; shift 2 ;;
    --frames-threshold) FRAMES_THRESHOLD="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Ports and result directories are shared, so a second bench must refuse to
# start rather than quietly corrupt this one. Everything the lock and the run
# leave behind comes back down through the one teardown installed just below.
#
# After the parser on purpose: `bash scripts/tracerbench.sh -- --nope` must die
# in the parser without ever taking the lock — `bench.common.test.sh` runs
# exactly that, and a lock taken first would litter a lock directory on every
# test run and could collide with a real bench.
acquire_bench_lock "$ROOT_DIR" "tracerbench"

# Set once the control worktree exists; until then `cleanup` has nothing to do.
WORKTREE_DIR=""
cleanup() {
  [[ -n "$WORKTREE_DIR" ]] || return 0
  # Remove git worktree (if registered) then the temp directory
  git -C "$ROOT_DIR" worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
  rm -rf "$WORKTREE_DIR" 2>/dev/null || true
}

# Playwright's web server outlives a Ctrl-C — it runs in a process group of its
# own — so the ports come down here too, and from the first stage on.
# Ports before the lock, so whoever takes it next finds them clear.
bench_teardown() {
  cleanup
  kill_bench_ports "$CONTROL_PORT" "$EXPERIMENT_PORT"
  release_bench_lock
}
trap_teardown bench_teardown

# What the reader is told the run will be judged against, spelled out rather
# than left to be inferred from two possibly-empty variables. Each branch says
# what actually gates, including the one where nothing does.
if [[ -n "$THRESHOLD" && -n "$FRAMES_THRESHOLD" ]]; then
  GATES="+${THRESHOLD}% ms / +${FRAMES_THRESHOLD}% frames"
elif [[ -n "$THRESHOLD" ]]; then
  GATES="+${THRESHOLD}% ms / +${THRESHOLD}% frames (frames borrows the ms width)"
elif [[ -n "$FRAMES_THRESHOLD" ]]; then
  GATES="+${FRAMES_THRESHOLD}% frames; ms ungated"
else
  GATES="none — measure only; declare thresholds.tracerbenchMs in bench.json to gate"
fi

CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
echo ""
echo "📊 TracerBench — local run"
echo "   experiment : $CURRENT_BRANCH (working tree)"
echo "   control    : $CONTROL_BRANCH"
echo "   thresholds : $GATES"
echo ""

# ── Clean previous results ───────────────────────────────────────────────────
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"

# ── 1. Build experiment (current branch) ─────────────────────────────────────
echo "⏳ Building experiment ($CURRENT_BRANCH)…"
(cd "$ROOT_DIR" && pnpm run build)
rm -rf "$ROOT_DIR/$DIST_DIR-experiment"
mv "$ROOT_DIR/$DIST_DIR" "$ROOT_DIR/$DIST_DIR-experiment"
echo "✅ Experiment build ready"
echo ""

# ── 2. Build control (target branch via worktree) ────────────────────────────
WORKTREE_DIR="$(mktemp -d)"

echo "⏳ Building control ($CONTROL_BRANCH)…"
# Try to fetch latest from remote; fall back to local ref when offline
if git -C "$ROOT_DIR" fetch origin "$CONTROL_BRANCH" 2>/dev/null; then
  CONTROL_REF="origin/$CONTROL_BRANCH"
else
  echo "   ⚠️  fetch failed (offline?), using local $CONTROL_BRANCH"
  CONTROL_REF="$CONTROL_BRANCH"
fi
git -C "$ROOT_DIR" worktree add "$WORKTREE_DIR" "$CONTROL_REF"
# Reuse node_modules from the main repo when the lockfile hasn't changed;
# only run pnpm install when it differs.
#
# In a workspace the root `node_modules` is not enough: pnpm splits a
# workspace's dependencies between the root store and a per-package
# `node_modules` holding that package's own deps and its `.bin`. Symlinking the
# root alone leaves those packages with no dependencies at all and the control
# build dies on the first import, so each one named in `workspacePackages` gets
# its own link. A single-package repo names none and the root link is the whole
# of it.
if diff -q "$ROOT_DIR/pnpm-lock.yaml" "$WORKTREE_DIR/pnpm-lock.yaml" >/dev/null 2>&1; then
  ln -s "$ROOT_DIR/node_modules" "$WORKTREE_DIR/node_modules"
  while IFS= read -r pkg; do
    mkdir -p "$WORKTREE_DIR/$pkg"
    ln -s "$ROOT_DIR/$pkg/node_modules" "$WORKTREE_DIR/$pkg/node_modules"
  done < <(bench_config_list workspacePackages)
else
  echo "   ⚠️  lockfile differs, running pnpm install…"
  (cd "$WORKTREE_DIR" && pnpm install --frozen-lockfile)
fi
(cd "$WORKTREE_DIR" && pnpm run build)
rm -rf "$ROOT_DIR/$DIST_DIR-control"
mv "$WORKTREE_DIR/$DIST_DIR" "$ROOT_DIR/$DIST_DIR-control"
# Free the worktree early; the teardown would also run it on exit.
cleanup
WORKTREE_DIR=""
echo "✅ Control build ready"
echo ""

# ── 3. Benchmark experiment ──────────────────────────────────────────────────
echo "⏳ Benchmarking experiment…"
(
  cd "$ROOT_DIR"
  TB_DIST="$DIST_NAME-experiment" \
  TB_PORT=$EXPERIMENT_PORT \
  TB_OUTPUT_DIR=tracerbench-results/experiment/traces \
  TB_COUNTERS=tracerbench-results/experiment/counters.json \
  PLAYWRIGHT_JSON_OUTPUT_FILE=tracerbench-results/experiment/report.json \
  pnpm run test:tracerbench
) || true
echo ""

# ── 4. Benchmark control ────────────────────────────────────────────────────
echo "⏳ Benchmarking control…"
(
  cd "$ROOT_DIR"
  TB_DIST="$DIST_NAME-control" \
  TB_PORT=$CONTROL_PORT \
  TB_OUTPUT_DIR=tracerbench-results/control/traces \
  TB_COUNTERS=tracerbench-results/control/counters.json \
  PLAYWRIGHT_JSON_OUTPUT_FILE=tracerbench-results/control/report.json \
  pnpm run test:tracerbench
) || true
echo ""

# ── 5. Compare ──────────────────────────────────────────────────────────────
#
# A flag is passed only when the config named a width. `--threshold ""` is not
# "no gate" to the comparer — it is an unparseable width, and there is no
# spelling of the flag that means "do not gate". Absence is that spelling.
#
# `REPRO` mirrors it: every width that gated this run is spelled out, so the
# command a reviewer pastes reproduces the verdict the comment reports rather
# than whatever the config says on the day they paste it.
COMPARE_ARGS=(
  "$RESULTS_DIR/control/report.json"
  "$RESULTS_DIR/experiment/report.json"
  --md "$RESULTS_DIR/comment.md"
)
REPRO="$SELF --control $CONTROL_BRANCH"
if [[ -n "$THRESHOLD" ]]; then
  COMPARE_ARGS+=(--threshold "$THRESHOLD")
  REPRO+=" --threshold $THRESHOLD"
fi
if [[ -n "$FRAMES_THRESHOLD" ]]; then
  COMPARE_ARGS+=(--frames-threshold "$FRAMES_THRESHOLD")
  REPRO+=" --frames-threshold $FRAMES_THRESHOLD"
fi

echo "⏳ Comparing results…"
"$ROOT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/tracerbench.compare.ts" \
  "${COMPARE_ARGS[@]}"

emit_comment_footer "$RESULTS_DIR/comment.md" "$ROOT_DIR" "$REPRO"

echo ""
if [[ -f "$RESULTS_DIR/comment.md" ]]; then
  echo "📄 $RESULTS_DIR/comment.md"
fi
