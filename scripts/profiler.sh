#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Profiler — runs `e2e/profiler.spec.ts` on the current branch (experiment) and
# on a control branch (default: main), then diffs:
#
#   - per-component fiber renders + cause classification (the gate), captured
#     by a runtime-injected bippy recorder — see `e2e/profiler-scan.injected.ts`
#   - coarse <React.Profiler> zone commit counts (advisory only)
#
# Diffing happens via `scripts/profiler-compare.ts`. Mirrors
# `scripts/tracerbench.sh` for dev/CI parity.
#
# Unlike TracerBench, this runs against `vite dev` (not a production build):
# `<React.Profiler>` only emits `onRender` events under a development build of
# `react-dom`. See the `<React.Profiler>` wrapper in the app for context.
#
# Usage:
#   pnpm run profiler                                    # compare current branch vs
#                                                        # auto-detected base (PR target
#                                                        # via gh / $GITHUB_BASE_REF,
#                                                        # else main)
#   pnpm run profiler -- --control feat/other            # explicit control branch
#   pnpm run profiler -- --threshold 25                  # custom advisory zone threshold
#   pnpm run profiler -- --component-threshold 25        # custom blocking component threshold
#   pnpm run profiler -- --component-min-renders 30      # custom blocking floor
#   pnpm run profiler -- --include-external              # surface Radix/shadcn in actionable sections
#   pnpm run profiler -- --strict                        # fail on regression (default: soft)
#
# Used by both `pnpm run profiler` locally and the CI `profiler` job.
# ──────────────────────────────────────────────────────────────────────────────

# Two roots, never one. `SCRIPT_DIR` is where this harness lives — a directory
# inside the consuming repo's `node_modules`, whose siblings this script sources
# and runs. `ROOT_DIR` is the repository being measured: every git operation,
# `.claude/bench.json`, the specs, `node_modules` and its `tsx` are all its.
# Confusing the two produces a plausible wrong number rather than an error.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git rev-parse --show-toplevel)"

# The path a reader pastes to re-run this, resolved against the invocation cwd
# *before* the `cd` below and expressed relative to the repo root — the scripts
# live in `node_modules` now, so `scripts/profiler.sh` is no longer their
# address and nothing here can write it down.
SELF="$0"
[[ "$SELF" == /* ]] || SELF="$PWD/$SELF"
SELF="${SELF#"$ROOT_DIR"/}"

# Every relative path below is repo-relative by construction, and
# `profiler-compare.ts` resolves the repo it greps from its own cwd.
cd "$ROOT_DIR"

RESULTS_DIR="$ROOT_DIR/profiler-results"
# One source of truth: the `PROFILER_PORT` lines below bind these, and the exit
# trap frees them. Experiment takes the odd port one above control, so a
# leftover server from the other side can never be silently reused.
CONTROL_PORT=4300
EXPERIMENT_PORT=4301
THRESHOLD=15
SOFT_FLAG="--soft"
COMPONENT_THRESHOLD=""
COMPONENT_MIN_RENDERS=""
INCLUDE_EXTERNAL=""

# Shared helpers: `default_control`, `emit_comment_footer`, `acquire_bench_lock`,
# `release_bench_lock`, `kill_bench_ports`, `trap_teardown`.
# shellcheck source=./_bench-common.sh
source "$SCRIPT_DIR/_bench-common.sh"
# `bench_config`, `bench_config_list` — the per-repo values, from
# `.claude/bench.json`.
# shellcheck source=./_bench-config.sh
source "$SCRIPT_DIR/_bench-config.sh"

CONTROL_BRANCH="$(default_control)"

# ── Parse arguments ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    # `pnpm run profiler -- --control x` forwards the `--` itself, unlike npm.
    # Swallow it, or the documented invocation dies on "Unknown option: --".
    --)                      shift ;;
    --control)               CONTROL_BRANCH="$2"; shift 2 ;;
    --threshold)             THRESHOLD="$2"; shift 2 ;;
    --component-threshold)   COMPONENT_THRESHOLD="$2"; shift 2 ;;
    --component-min-renders) COMPONENT_MIN_RENDERS="$2"; shift 2 ;;
    --include-external)      INCLUDE_EXTERNAL="--include-external"; shift ;;
    --strict)                SOFT_FLAG=""; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Ports and result directories are shared, so a second bench must refuse to
# start rather than quietly corrupt this one — and locally Playwright would
# reuse a dev server the other run started, benching the wrong branch.
# Everything it leaves behind comes back down through the teardown below.
#
# After the parser on purpose: `bash scripts/profiler.sh -- --nope` must die in
# the parser without ever taking the lock — `_bench-common.test.sh` runs exactly
# that, and a lock taken first would litter a lock directory on every test run
# and could collide with a real bench.
acquire_bench_lock "$ROOT_DIR" "profiler"

# Set once the control worktree exists; until then `cleanup` has nothing to do.
# Declared up front because the experiment side benches — and binds a port —
# before that worktree exists, so one teardown has to cover the whole script.
WORKTREE_DIR=""
cleanup() {
  [[ -n "$WORKTREE_DIR" ]] || return 0
  # Remove git worktree (if registered) then the temp directory
  git -C "$ROOT_DIR" worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
  rm -rf "$WORKTREE_DIR" 2>/dev/null || true
}

# Playwright's web server outlives a Ctrl-C — it runs in a process group of its
# own — so the ports come down here too, and from the experiment run on, which
# binds one long before the control worktree exists.
# Ports before the lock, so whoever takes it next finds them clear.
bench_teardown() {
  cleanup
  kill_bench_ports "$CONTROL_PORT" "$EXPERIMENT_PORT"
  release_bench_lock
}
trap_teardown bench_teardown

CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
echo ""
echo "🧪 Profiler — local run"
echo "   experiment : $CURRENT_BRANCH (working tree)"
echo "   control    : $CONTROL_BRANCH"
echo "   threshold  : +${THRESHOLD}%"
echo "   mode       : $([ -z "$SOFT_FLAG" ] && echo strict || echo soft)"
echo ""

# ── Clean previous results ───────────────────────────────────────────────────
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR/control" "$RESULTS_DIR/experiment"

# ── 0. Pre-build the bippy recorder bundle ───────────────────────────────────
# Built once on the experiment side (which has bippy + esbuild as dev deps),
# then handed verbatim to both runs via $PROFILER_SCAN_BUNDLE. The control
# branch never resolves bippy/esbuild — it just executes the IIFE.
SCAN_BUNDLE="$RESULTS_DIR/scan-bundle.js"
echo "⏳ Building scan bundle…"
(
  cd "$ROOT_DIR"
  pnpm exec esbuild "$ROOT_DIR/e2e/profiler-scan.injected.ts" \
    --bundle --format=iife --target=es2020 --platform=browser \
    --keep-names --outfile="$SCAN_BUNDLE" --log-level=warning
)
echo "✅ scan bundle: $SCAN_BUNDLE ($(wc -c <"$SCAN_BUNDLE" | tr -d ' ') bytes)"
echo ""

# ── 1. Benchmark experiment (current branch) ─────────────────────────────────
echo "⏳ Benchmarking experiment ($CURRENT_BRANCH)…"
(
  cd "$ROOT_DIR"
  PROFILER_PORT=$EXPERIMENT_PORT \
  PROFILER_REPORT="$RESULTS_DIR/experiment/report.json" \
  PROFILER_SCAN_BUNDLE="$SCAN_BUNDLE" \
  pnpm run test:profiler
) || true
echo ""

# ── 2. Benchmark control (target branch via worktree) ───────────────────────
WORKTREE_DIR="$(mktemp -d)"

echo "⏳ Preparing control worktree ($CONTROL_BRANCH)…"
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
# dev server dies on the first import, so each one named in `workspacePackages`
# gets its own link. A single-package repo names none and the root link is the
# whole of it.
if diff -q "$ROOT_DIR/pnpm-lock.yaml" "$WORKTREE_DIR/pnpm-lock.yaml" >/dev/null 2>&1; then
  ln -s "$ROOT_DIR/node_modules" "$WORKTREE_DIR/node_modules"
  while IFS= read -r pkg; do
    mkdir -p "$WORKTREE_DIR/$pkg"
    ln -s "$ROOT_DIR/$pkg/node_modules" "$WORKTREE_DIR/$pkg/node_modules"
  done < <(bench_config_list workspacePackages)
else
  echo "   ⚠️  lockfile differs, running pnpm install in worktree…"
  (cd "$WORKTREE_DIR" && pnpm install --frozen-lockfile)
fi
echo "✅ Control worktree ready"
echo ""

# Always use the current branch's spec and config so both sides run the same
# scenario. This matters both when the control predates the spec entirely
# (no tests found) and when the spec is updated on the experiment branch
# (stale spec would compare different interactions, making the diff meaningless).
# `profiler-scan.setup.ts` is also copied because Playwright's `globalSetup`
# resolves it relative to the worktree's config — but at runtime it sees the
# pre-built `$SCAN_BUNDLE` and short-circuits without touching esbuild/bippy.
# `profiler-scan.injected.ts` is deliberately *not* copied: that pre-built
# bundle is exactly what replaces it.
mkdir -p "$WORKTREE_DIR/e2e"
cp "$ROOT_DIR/e2e/profiler.spec.ts" "$WORKTREE_DIR/e2e/profiler.spec.ts"
cp "$ROOT_DIR/e2e/profiler-scan.setup.ts" "$WORKTREE_DIR/e2e/profiler-scan.setup.ts"
# Spec imports `./gestures` (shared human-like drag helpers) — copy it too so
# the import resolves when the control branch predates the shared module.
cp "$ROOT_DIR/e2e/gestures.ts" "$WORKTREE_DIR/e2e/gestures.ts"
cp "$ROOT_DIR/playwright.profiler.config.ts" "$WORKTREE_DIR/playwright.profiler.config.ts"
# `profiler-aggregate`, which the spec imports, is deliberately *not* copied:
# it lives in this package, and the worktree's `node_modules` is a symlink to
# the experiment side's, so the package specifier already resolves to the
# working tree's copy. Only the repo's own files have to travel with the spec.
# Whatever else this repo's spec reaches for, on top of that core. Same reason
# every time: the control branch may predate the module, so the working tree's
# copy has to travel with the spec.
while IFS= read -r rel; do
  mkdir -p "$WORKTREE_DIR/$(dirname "$rel")"
  cp "$ROOT_DIR/$rel" "$WORKTREE_DIR/$rel"
done < <(bench_config_list controlWorktreeCopy)

echo "⏳ Benchmarking control ($CONTROL_BRANCH)…"
(
  cd "$WORKTREE_DIR"
  PROFILER_PORT=$CONTROL_PORT \
  PROFILER_REPORT="$RESULTS_DIR/control/report.json" \
  PROFILER_SCAN_BUNDLE="$SCAN_BUNDLE" \
  "$WORKTREE_DIR/node_modules/.bin/playwright" test --config playwright.profiler.config.ts
) || true
# Free the worktree before the compare step (the teardown would also run it on
# exit, but cleaning up early reclaims disk while we still have work to do).
cleanup
WORKTREE_DIR=""
echo ""

# ── 3. Compare ──────────────────────────────────────────────────────────────
# Graceful handling: if either side failed to produce a report, emit an
# explanatory comment instead of crashing the comparison script. This is
# expected on the very PR that *introduces* the profiler infra — the control
# branch (typically `main`) lacks `<React.Profiler>` until that PR merges.
CONTROL_REPORT="$RESULTS_DIR/control/report.json"
EXPERIMENT_REPORT="$RESULTS_DIR/experiment/report.json"

if [[ ! -f "$EXPERIMENT_REPORT" ]]; then
  # No experiment report = nothing to show. Hard fallback.
  echo "⚠️  Experiment report missing — cannot proceed."
  {
    echo "## 🧪 Profiler — re-render regression check"
    echo ""
    echo "❌ **Experiment report missing** — the bench failed to produce data for this PR's branch."
  } > "$RESULTS_DIR/comment.md"
elif [[ ! -f "$CONTROL_REPORT" ]]; then
  # Experiment-only mode: control failed (typical when the target branch
  # predates the profiler infra and can't run the scripted scenario).
  # We still produce a useful comment by running `profiler-compare` with
  # experiment as both sides — the resulting tables show this PR's
  # actual measurements (all deltas = 0), and we prepend a banner that
  # makes the "no baseline" status explicit.
  echo "⚠️  Control report missing — emitting experiment-only summary."

  # Banner emits the single `## Profiler …` header (we strip the
  # duplicate that profiler-compare prepends, see the `tail -n +2` below)
  # then the "no baseline" notice, then a separator.
  BASELINE_BANNER="$RESULTS_DIR/baseline-banner.md"
  {
    echo "## 🧪 Profiler — re-render regression check"
    echo ""
    echo "### No baseline available"
    echo ""
    echo "The control branch (\`$CONTROL_BRANCH\`) couldn't produce a report (likely predates the \`<React.Profiler>\` / bippy instrumentation, or its app shell differs enough that the scripted scenario can't run). Once these commits land on \`$CONTROL_BRANCH\`, subsequent PRs will get a real diff against this baseline."
    echo ""
    echo "Showing this PR's standalone measurements below (deltas read as +0% because there is no real baseline)."
    echo ""
    echo "---"
    echo ""
  } > "$BASELINE_BANNER"

  COMPARE_ARGS=(
    "$EXPERIMENT_REPORT"
    "$EXPERIMENT_REPORT"
    --md "$RESULTS_DIR/_compare.md"
    --threshold "$THRESHOLD"
    --soft
  )
  "$ROOT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/profiler-compare.ts" "${COMPARE_ARGS[@]}" || true
  if [[ -f "$RESULTS_DIR/_compare.md" ]]; then
    # `tail -n +2` drops profiler-compare's own `## Profiler …` title
    # since the banner already provides one — avoids the double-title bug.
    { cat "$BASELINE_BANNER"; tail -n +2 "$RESULTS_DIR/_compare.md"; } > "$RESULTS_DIR/comment.md"
    rm -f "$BASELINE_BANNER" "$RESULTS_DIR/_compare.md"
  else
    # Compare itself failed — fall back to bare banner.
    cp "$BASELINE_BANNER" "$RESULTS_DIR/comment.md"
    rm -f "$BASELINE_BANNER"
  fi
else
  echo "⏳ Comparing results…"
  COMPARE_ARGS=(
    "$CONTROL_REPORT"
    "$EXPERIMENT_REPORT"
    --md "$RESULTS_DIR/comment.md"
    --threshold "$THRESHOLD"
  )
  if [[ -n "$COMPONENT_THRESHOLD" ]]; then
    COMPARE_ARGS+=(--component-threshold "$COMPONENT_THRESHOLD")
  fi
  if [[ -n "$COMPONENT_MIN_RENDERS" ]]; then
    COMPARE_ARGS+=(--component-min-renders "$COMPONENT_MIN_RENDERS")
  fi
  if [[ -n "$INCLUDE_EXTERNAL" ]]; then
    COMPARE_ARGS+=("$INCLUDE_EXTERNAL")
  fi
  if [[ -n "$SOFT_FLAG" ]]; then
    COMPARE_ARGS+=("$SOFT_FLAG")
  fi
  "$ROOT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/profiler-compare.ts" "${COMPARE_ARGS[@]}"
fi

# The repro command is rebuilt from the resolved flags rather than echoed from
# "$@": every one of them changes what the comment says, and `--strict` decides
# whether a regression exits non-zero — a command missing it reproduces the table
# but not the verdict the comment reports. Spelling the defaults out keeps an old
# comment reproducible after a default moves.
REPRO="bash $SELF --control $CONTROL_BRANCH --threshold $THRESHOLD"
if [[ -z "$SOFT_FLAG" ]]; then
  REPRO+=" --strict"
fi
if [[ -n "$COMPONENT_THRESHOLD" ]]; then
  REPRO+=" --component-threshold $COMPONENT_THRESHOLD"
fi
if [[ -n "$COMPONENT_MIN_RENDERS" ]]; then
  REPRO+=" --component-min-renders $COMPONENT_MIN_RENDERS"
fi
if [[ -n "$INCLUDE_EXTERNAL" ]]; then
  REPRO+=" $INCLUDE_EXTERNAL"
fi

emit_comment_footer "$RESULTS_DIR/comment.md" "$ROOT_DIR" "$REPRO"

echo ""
if [[ -f "$RESULTS_DIR/comment.md" ]]; then
  echo "📄 $RESULTS_DIR/comment.md"
fi
