#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Profiler — runs `e2e/profiler.spec.ts` on the current branch (experiment) and
# on a control branch (default: main), then diffs:
#
#   - per-component fiber renders + cause classification (the gate), captured
#     by a runtime-injected bippy recorder — this package's
#     `profiler.scan.injected.ts`, bundled by its `profiler.scan.setup.mjs`
#   - coarse <React.Profiler> zone commit counts (advisory only)
#
# The spec writes one file per side: its raw commit log, at
# `$PROFILER_COMMITS`. `profiler.aggregate.ts` folds that into the per-component
# report, and `profiler.compare.ts` diffs the two reports. Both run through the
# measured repo's own `tsx`. Mirrors `scripts/tracerbench.sh` for dev/CI parity.
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
#   pnpm run profiler -- --no-cache                      # re-measure the control side
#
# Used by both `pnpm run profiler` locally and the CI `profiler` job.
# ──────────────────────────────────────────────────────────────────────────────

# Two roots, never one. `SCRIPT_DIR` is where this harness lives — a directory
# inside the consuming repo's `node_modules`, whose siblings this script sources
# and runs. `ROOT_DIR` is the repository being measured: every git operation,
# `bench.json`, the specs, `node_modules` and its `tsx` are all its.
# Confusing the two produces a plausible wrong number rather than an error.

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

# The command a reader pastes to re-run this.
#
# Named, not spelled out as a path, whenever this was reached through its `bin`
# entry — which is how a repo runs it now. `$0` does not carry that name under
# every package manager (npm symlinks the bin, pnpm execs the real file through
# a shim), so it is recognised by basename instead: `profiler` and
# `profiler.sh` are the same program, and both print as
# `pnpm exec profiler`, which resolves from anywhere in the repo. That is
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
# root. The scripts live in `node_modules`, so `scripts/profiler.sh` is no
# longer their address and nothing here can write it down.
if [[ "$(basename "$0")" == "profiler" || "$(basename "$0")" == "profiler.sh" ]]; then
  SELF="pnpm exec profiler"
else
  SELF="$0"
  [[ "$SELF" == /* ]] || SELF="$PWD/$SELF"
  SELF="bash ${SELF#"$ROOT_DIR"/}"
fi

# Every relative path below is repo-relative by construction, and
# `profiler.compare.ts` resolves the repo it greps from its own cwd.
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
# Empty means "whatever the comparer defaults to" — the same contract every
# other width here has, so a default can move in one place.
STEP_MIN_RENDERS=""
INCLUDE_EXTERNAL=""

# Reusing the control side is the default; `--no-cache` and
# `PROFILER_CONTROL_CACHE=0` both turn it off. Two doors, because they open onto
# different rooms: `--no-cache` is for `pnpm exec profiler`, and the environment
# variable is the only one that reaches this script through `lgtm-perf` — which
# forwards its arguments to `tracerbench.sh` as well, where `--no-cache` is not
# an option and would kill the gate in its parser.
CONTROL_CACHE="${PROFILER_CONTROL_CACHE:-1}"

# Shared helpers: `default_control`, `emit_comment_footer`, `acquire_bench_lock`,
# `release_bench_lock`, `kill_bench_ports`, `trap_teardown`.
# shellcheck source=./bench.common.sh
source "$SCRIPT_DIR/bench.common.sh"
# `bench_config`, `bench_config_list` — the per-repo values, from `bench.json`.
# shellcheck source=./bench.config.sh
source "$SCRIPT_DIR/bench.config.sh"

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
    --step-min-renders)      STEP_MIN_RENDERS="$2"; shift 2 ;;
    --include-external)      INCLUDE_EXTERNAL="--include-external"; shift ;;
    --strict)                SOFT_FLAG=""; shift ;;
    --no-cache)              CONTROL_CACHE=0; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# One bench at a time on this machine: within a repo they share ports and result
# directories — locally Playwright would reuse a dev server the other run
# started, benching the wrong branch — and across repos they still share the CPU
# they are timing. So this waits for whatever is running before it starts; see
# the lock's own header for the bound and how to refuse instead. Everything it
# leaves behind comes back down through the teardown below.
#
# After the parser on purpose: `bash scripts/profiler.sh -- --nope` must die in
# the parser without ever taking the lock — `bench.common.test.sh` runs exactly
# that, and a lock taken first would litter a lock directory on every test run
# and could collide with a real bench.
acquire_bench_lock "profiler"

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

# Fold one side's raw commit log into the report `profiler.compare.ts` reads.
# A side that produced no commit log ran a spec that failed or predates the
# harness — it gets no report, and the compare step below turns that into a red
# run rather than a diff of one side against itself. A commit log that exists
# but cannot be folded is a broken contract instead, and `profiler.aggregate.ts`
# exits non-zero, which stops the run: an empty aggregate would read as "no
# regressions".
aggregate_side() {
  local side="$1"
  local commits="$RESULTS_DIR/$side/commits.json"
  if [[ ! -f "$commits" ]]; then
    echo "❌ No $side commit log ($commits) — the $side leg recorded nothing, so it gets no report."
    return 0
  fi
  echo "⏳ Aggregating $side commit log…"
  "$ROOT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/profiler.aggregate.ts" \
    "$commits" "$RESULTS_DIR/$side/report.json"
}

# ── The control side, cached ─────────────────────────────────────────────────
#
# The control leg is the largest single cost of a run — a worktree, an install
# or a symlink, a dev server and the whole catalogue, around 90 s of it — spent
# re-measuring a branch that has not moved since the last time it was measured.
#
# Unlike wall clock, what that leg produces is reproducible. On identical code
# the two sides came out at 157,440 against 157,103 fiber renders, 0.2% apart,
# and a step as busy as `slider-hover` agreed to the render: 37,355 on both
# sides. A render count is a property of the code where a millisecond is a
# property of the machine on the day — which is why this lives in this file and
# not in `bench.common.sh`. `tracerbench.sh` must never grow a cache off these
# helpers: caching a duration is caching the weather.
#
# The risk is entirely one-sided. A key that moves when it need not costs one
# extra control leg and nothing else. A key that fails to move when it should
# hands the comparer a baseline for code that is no longer there — and a
# regression measured against the wrong control reads as a **green run**, which
# is the one failure this harness exists to refuse. So the key carries every
# input that can change what the control leg produces, and wherever a cheap
# over-approximation exists it is preferred to a precise one.
#
# What is in it, and why:
#
#   - **the control commit.** The code being measured. Its own `pnpm-lock.yaml`
#     rides along inside it, so the control's Playwright and Chromium are here.
#   - **this whole harness, hashed by content.** The script that runs the leg
#     and the aggregate that folds it. Content rather than the package version,
#     so an edited working copy invalidates too; over-invalidating on an
#     unrelated `branchstat.sh` edit is the cheap half of the trade.
#   - **the scan bundle.** The recorder injected into both sides, and with it
#     whichever `bippy` the measured repo resolved.
#   - **the spec, the Playwright config, `bench.json`, and every file
#     `controlWorktreeCopy` names.** The experiment's apparatus, laid over the
#     control worktree. This is where a catalogue lives: an `e2e/marks.ts` that
#     changed is a different scenario, and reusing a report measured under the
#     old one compares two different benches.
#   - **the experiment's `pnpm-lock.yaml`.** It decides whether the worktree
#     symlinks `node_modules` or installs its own, which is a different
#     dependency tree for the leg to run in.
#   - **the resolved `@playwright/test` version**, standing in for the Chromium
#     build. The two lockfiles already pin it; this catches a tree installed
#     from a different one.
#
# What is deliberately *not* in it: every flag that only reaches the comparer —
# `--threshold`, `--component-threshold`, `--component-min-renders`,
# `--step-min-renders`, `--include-external`, `--strict`. They change the
# verdict, never the measurement, and keying on them would throw a perfectly
# good report away every time someone widened a gate.
#
# One thing the key cannot cover, recorded rather than resolved: it hashes the
# *lockfiles*, not the installed trees they describe. A `node_modules` edited by
# hand under an unchanged lockfile is invisible to it.
#
# In the **common** git dir, so every worktree of this repo shares one cache. A
# control report is a property of a commit and an apparatus, both of which are
# in the key; which worktree first measured it is not.
CACHE_ROOT="$(cd "$ROOT_DIR" && cd "$(git rev-parse --git-common-dir)" && pwd)/profiler-control-cache"
# One entry per (control commit × apparatus). A base branch that advances daily
# would otherwise accumulate one a day forever, and the newest few are the only
# ones anybody comes back to.
CACHE_KEEP=5

# `shasum` on macOS, `sha256sum` on a runner. Both read a file list or stdin and
# print `<hash>  <name>`.
if command -v shasum >/dev/null 2>&1; then
  SHA256=(shasum -a 256)
else
  SHA256=(sha256sum)
fi

# One hash over every file of this harness, with the paths excluded — the same
# scripts must hash the same whether they are read from a checkout of this
# repository or from a consumer's `node_modules`, which is the whole point.
harness_hash() {
  find "$SCRIPT_DIR" -type f -print0 |
    LC_ALL=C sort -z |
    xargs -0 "${SHA256[@]}" |
    cut -d' ' -f1 |
    "${SHA256[@]}" |
    cut -d' ' -f1
}

# `<hash> <label>`, or `- <label>` when the file is absent. Absence is part of
# the key and never a reason to leave a line out: a `controlWorktreeCopy` entry
# that appears or disappears changes what the control worktree contains.
cache_manifest_file() {
  local label="$1" file="$2"
  if [[ -f "$file" ]]; then
    printf '%s %s\n' "$("${SHA256[@]}" "$file" | cut -d' ' -f1)" "$label"
  else
    printf -- '- %s\n' "$label"
  fi
}

# The key in longhand, stored beside the entry it names — so two keys that
# disagree can be diffed to find out which input moved, which is the only way to
# debug a cache that misses when it should hit. `CONTROL_SHA` and `SCAN_BUNDLE`
# must both be set before this is called.
control_cache_manifest() {
  echo "control $CONTROL_SHA"
  echo "harness $HARNESS_HASH"
  echo "playwright $(node -p "require('@playwright/test/package.json').version" 2>/dev/null || echo unknown)"
  cache_manifest_file "scan-bundle" "$SCAN_BUNDLE"
  cache_manifest_file "e2e/profiler.spec.ts" "$ROOT_DIR/e2e/profiler.spec.ts"
  cache_manifest_file "playwright.profiler.config.ts" "$ROOT_DIR/playwright.profiler.config.ts"
  cache_manifest_file "bench.json" "$ROOT_DIR/bench.json"
  cache_manifest_file "pnpm-lock.yaml" "$ROOT_DIR/pnpm-lock.yaml"
  while IFS= read -r rel; do
    cache_manifest_file "$rel" "$ROOT_DIR/$rel"
  done < <(bench_config_list controlWorktreeCopy)
}

# Everything past the newest `CACHE_KEEP` entries, by last *use*.
prune_control_cache() {
  local stale dir
  stale="$(ls -1dt "$CACHE_ROOT"/*/ 2>/dev/null | tail -n +$((CACHE_KEEP + 1)))"
  [[ -n "$stale" ]] || return 0
  while IFS= read -r dir; do
    rm -rf "$dir"
  done <<< "$stale"
  return 0
}

# Keep this leg's report for the next run that asks the same question.
#
# Best-effort throughout: a cache that cannot be written is a slower run, never
# a failed one, so every step swallows its own error and the function always
# returns 0. Written to a scratch directory and renamed into place, so an
# interrupted write cannot leave a half-file under a key that claims to be
# complete.
store_control_cache() {
  local staging="$CACHE_ENTRY.staging"
  rm -rf "$staging"
  mkdir -p "$staging" 2>/dev/null || return 0
  cp "$RESULTS_DIR/control/report.json" "$staging/report.json" 2>/dev/null || {
    rm -rf "$staging"
    return 0
  }
  # Compressed, and only this one. The raw commit log is the whole catalogue's
  # every fiber render with its cause — 32.6 MB on `tilt`, against 375 KB for
  # the report folded out of it. Nothing downstream reads it: the comparer diffs
  # the reports, and this is restored only so a cache hit leaves the same
  # artefacts on disk as the run it stands in for. Paying 32 MB an entry for a
  # file kept purely to be read by hand is not a trade worth making, and it is
  # JSON — measured 32.6 MB to 874 KB, 37x, in 0.14 s to write and 0.02 s to
  # read back. The report stays plain: it is small, and it is the one file every
  # cache hit has to open.
  if [[ -f "$RESULTS_DIR/control/commits.json" ]]; then
    gzip -c "$RESULTS_DIR/control/commits.json" > "$staging/commits.json.gz" 2>/dev/null || true
  fi
  printf '%s\n' "$CACHE_MANIFEST" > "$staging/key.txt" 2>/dev/null || true
  rm -rf "$CACHE_ENTRY"
  mv "$staging" "$CACHE_ENTRY" 2>/dev/null || {
    rm -rf "$staging"
    return 0
  }
  prune_control_cache
  return 0
}

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
#
# The recorder is this package's (`$SCRIPT_DIR`), the `bippy` it inlines is the
# measured repo's (`$ROOT_DIR`). esbuild resolves imports by walking up from the
# entry point, which under pnpm is a store directory whose siblings are this
# package's own deps — `NODE_PATH` is the extra place it looks, and it is what
# puts the measured repo's `bippy` in the bundle. `profiler.scan.setup.mjs`
# passes the same directory as `nodePaths` when it builds the bundle itself.
SCAN_BUNDLE="$RESULTS_DIR/scan-bundle.js"
echo "⏳ Building scan bundle…"
(
  cd "$ROOT_DIR"
  NODE_PATH="$ROOT_DIR/node_modules" \
  pnpm exec esbuild "$SCRIPT_DIR/profiler.scan.injected.ts" \
    --bundle --format=iife --target=es2020 --platform=browser \
    --keep-names --outfile="$SCAN_BUNDLE" --log-level=warning
)
echo "✅ scan bundle: $SCAN_BUNDLE ($(wc -c <"$SCAN_BUNDLE" | tr -d ' ') bytes)"
echo ""

# ── 1. Benchmark experiment (current branch) ─────────────────────────────────
# A leg is allowed to fail without stopping the run — the other side is still
# worth measuring, and the compare step is what decides the verdict. What is not
# allowed is failing quietly: a leg that dies at config load is discovered pages
# later as a missing report, and "no report" reads as a much smaller problem
# than "the spec never started". So each leg's status is kept and said out loud
# here, where the output explaining it is still on screen.
#
# Failing does not *stop* the run — the measurement is still worth having, and
# the compare step still runs — but a red experiment leg does gate, at the exit
# line below. The spec's assertions are the branch's verdict on itself: the
# family-B ceiling ("this gesture must not commit React per pointer event") is
# one of them, and a catalogue's whole reason for existing can live in an
# assertion no percentage threshold can express. Dropping that status let a
# planted camera-state leak — orbit 2 → 444 commits — through a green run.
#
# The control leg is deliberately not gated: it measures the base branch, and
# reddening this branch for what main asserts about itself would block a PR for
# somebody else's finding. It is still printed.
echo "⏳ Benchmarking experiment ($CURRENT_BRANCH)…"
EXPERIMENT_LEG=0
(
  cd "$ROOT_DIR"
  PROFILER_PORT=$EXPERIMENT_PORT \
  PROFILER_COMMITS="$RESULTS_DIR/experiment/commits.json" \
  PROFILER_SCAN_BUNDLE="$SCAN_BUNDLE" \
  pnpm run test:profiler
) || EXPERIMENT_LEG=$?
[[ $EXPERIMENT_LEG -eq 0 ]] || echo "❌ The experiment leg exited $EXPERIMENT_LEG — its output above says why."
aggregate_side experiment
echo ""

# ── 2. Benchmark control (target branch via worktree) ───────────────────────
# The control commit is resolved before anything is prepared: it is the first
# line of the cache key below, and on a hit none of the preparation happens.
echo "⏳ Resolving control ($CONTROL_BRANCH)…"
# Try to fetch latest from remote; fall back to local ref when offline
if git -C "$ROOT_DIR" fetch origin "$CONTROL_BRANCH" 2>/dev/null; then
  CONTROL_REF="origin/$CONTROL_BRANCH"
else
  echo "   ⚠️  fetch failed (offline?), using local $CONTROL_BRANCH"
  CONTROL_REF="$CONTROL_BRANCH"
fi
CONTROL_SHA="$(git -C "$ROOT_DIR" rev-parse "$CONTROL_REF")"

# A key is only worth having if every line of it landed. `harness_hash` is a
# five-stage pipeline over a directory this script does not own, and an empty
# result would key the cache on everything *except* the harness — a hole of
# exactly the kind this whole mechanism is written to avoid. So it is computed
# here, where a failure can still be acted on, and a run that cannot key its
# cache measures the control side instead of guessing.
HARNESS_HASH="$(harness_hash || true)"
CACHE_KEYABLE=1
if [[ -z "$HARNESS_HASH" ]]; then
  echo "   ⚠️  Could not hash the harness at $SCRIPT_DIR — measuring the control side."
  CACHE_KEYABLE=""
  HARNESS_HASH="unkeyable"
fi

CACHE_MANIFEST="$(control_cache_manifest)"
CACHE_KEY="$(printf '%s\n' "$CACHE_MANIFEST" | "${SHA256[@]}" | cut -d' ' -f1)"
CACHE_ENTRY="$CACHE_ROOT/$CACHE_KEY"
CONTROL_CACHE_HIT=""
CONTROL_LEG=0

if [[ -n "$CACHE_KEYABLE" && "$CONTROL_CACHE" != "0" && -f "$CACHE_ENTRY/report.json" ]]; then
  CONTROL_CACHE_HIT=1
  echo "♻️  Reusing the cached control report — $CONTROL_BRANCH at ${CONTROL_SHA:0:7}"
  echo "   Same commit, same spec, same recorder, same harness: nothing that"
  echo "   decides what the control leg measures has moved since it measured it."
  echo "   key ${CACHE_KEY:0:12} — $CACHE_ENTRY/key.txt"
  echo "   Re-measure it with PROFILER_CONTROL_CACHE=0, or --no-cache."
  cp "$CACHE_ENTRY/report.json" "$RESULTS_DIR/control/report.json"
  if [[ -f "$CACHE_ENTRY/commits.json.gz" ]]; then
    gunzip -c "$CACHE_ENTRY/commits.json.gz" > "$RESULTS_DIR/control/commits.json"
  fi
  # Last use, not last write: pruning keeps whatever is still being asked for.
  touch "$CACHE_ENTRY"
else
  WORKTREE_DIR="$(mktemp -d)"

  echo "⏳ Preparing control worktree ($CONTROL_BRANCH)…"
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

    # The control supplies the application. The experiment supplies the apparatus.
    #
    # That install just gave the worktree the *control's* dependency tree, and
    # this package is in it at whatever version the control branch pinned — or,
    # on the PR that introduces the bench, not at all. The spec and the config
    # copied in below are the experiment's, so every subpath they import has to
    # exist over there. Both halves of that have been seen in the wild:
    # `ERR_PACKAGE_PATH_NOT_EXPORTED` where the base pinned a version predating
    # the subpath, and `Cannot find package '@abernier/skills'` where the base
    # predates the package. Neither says anything about the PR — the branch that
    # adds a bench can never have a baseline that already ran it — so the
    # experiment's copy is laid over whatever the install produced.
    #
    # Copied, never symlinked. Node resolves a symlinked package from its real
    # location, so through a link this package's `@playwright/test` — its only
    # peer dependency — would come from the *experiment's* tree while the
    # control's own binary drives the run: two Playwright instances in one
    # process, and a spec importing `@abernier/skills/bench-tests` registers its
    # tests in the one nobody is listening to. A copy resolves upward through the
    # worktree's own `node_modules`, which is the control's Playwright, which is
    # the one running.
    #
    # `package.json` plus this directory are the whole of what the package ships
    # — see its `files` — and it declares no runtime dependencies, so there is
    # nothing else to bring.
    APPARATUS="$WORKTREE_DIR/node_modules/@abernier/skills"
    {
      rm -rf "$APPARATUS" &&
        mkdir -p "$APPARATUS" &&
        cp "$SCRIPT_DIR/../package.json" "$APPARATUS/package.json" &&
        cp -R "$SCRIPT_DIR" "$APPARATUS/$(basename "$SCRIPT_DIR")"
    } || {
      # Loudly, and without measuring. A control leg left on the control's copy
      # of the harness either dies at config load or measures a different
      # scenario, and both read downstream as "the control produced no report" —
      # a sentence about the branch, which this is not.
      echo "❌ Could not put this harness into the control worktree ($APPARATUS)."
      echo "   Refusing to bench the control against a harness that is not this one."
      exit 1
    }
  fi
  echo "✅ Control worktree ready"
  echo ""

  # Always use the current branch's spec and config so both sides run the same
  # scenario. This matters both when the control predates the spec entirely
  # (no tests found) and when the spec is updated on the experiment branch
  # (stale spec would compare different interactions, making the diff meaningless).
  # The `globalSetup` those configs name is `@abernier/skills/profiler-scan`,
  # which the worktree resolves through the `node_modules` it was just given — so
  # nothing about it is copied. It short-circuits anyway: it sees the pre-built
  # `$SCAN_BUNDLE` and returns without touching esbuild or bippy, which the
  # control branch may not have at all.
  mkdir -p "$WORKTREE_DIR/e2e"
  cp "$ROOT_DIR/e2e/profiler.spec.ts" "$WORKTREE_DIR/e2e/profiler.spec.ts"
  cp "$ROOT_DIR/playwright.profiler.config.ts" "$WORKTREE_DIR/playwright.profiler.config.ts"
  # Whatever else this repo's spec reaches for, on top of that core. Same reason
  # every time: the control branch may predate the module, so the working tree's
  # copy has to travel with the spec. The gesture helpers and the scan setup used
  # to be copied here unconditionally, as the files every consumer had; they now
  # come from `@abernier/skills/gestures` and `@abernier/skills/profiler-scan`,
  # which the worktree resolves the same way its `playwright` binary does. A repo
  # keeping gestures or a recorder of its own declares that file here like any
  # other.
  while IFS= read -r rel; do
    mkdir -p "$WORKTREE_DIR/$(dirname "$rel")"
    cp "$ROOT_DIR/$rel" "$WORKTREE_DIR/$rel"
  done < <(bench_config_list controlWorktreeCopy)

  echo "⏳ Benchmarking control ($CONTROL_BRANCH)…"
  (
    cd "$WORKTREE_DIR"
    PROFILER_PORT=$CONTROL_PORT \
    PROFILER_COMMITS="$RESULTS_DIR/control/commits.json" \
    PROFILER_SCAN_BUNDLE="$SCAN_BUNDLE" \
    "$WORKTREE_DIR/node_modules/.bin/playwright" test --config playwright.profiler.config.ts
  ) || CONTROL_LEG=$?
  [[ $CONTROL_LEG -eq 0 ]] || echo "❌ The control leg exited $CONTROL_LEG — its output above says why."
  aggregate_side control
  # Free the worktree before the compare step (the teardown would also run it on
  # exit, but cleaning up early reclaims disk while we still have work to do).
  cleanup
  WORKTREE_DIR=""

  # Only a leg that ran clean is worth keeping. A control that failed its own
  # assertions, or timed out on a mark, produced a report of a run that did not
  # happen the way it was meant to — and caching it would freeze that accident
  # in as the baseline every later run on this branch is judged against.
  #
  # `--no-cache` still stores. The hatch is for a baseline somebody stopped
  # trusting: re-measuring it and then throwing the fresh report away would make
  # the next run pay for the same doubt all over again.
  if [[ -n "$CACHE_KEYABLE" && $CONTROL_LEG -eq 0 && -f "$RESULTS_DIR/control/report.json" ]]; then
    store_control_cache
  fi
fi

echo ""

# ── 3. Compare ──────────────────────────────────────────────────────────────
# A side that produced no report gets a comment saying so rather than a crash:
# what *was* measured is still worth printing, and on the PR that introduces the
# profiler to a repo — where the control branch cannot run the scenario at all —
# that comment is the whole deliverable.
#
# What such a run is not is a pass. Nothing was compared, so no number in it is
# a comparison, and the run exits non-zero. `profiler.aggregate.ts` refuses an
# unfoldable commit log for exactly this reason one level down: an answer that
# looks like "no regressions" must never come out of a bench that did not
# measure. There is no legitimate case here of "nothing to compare against" —
# both sides run the *experiment's* spec and config, so a control that cannot
# produce a report is a control that could not run this bench, never a control
# there was no point comparing to.
#
# CI keeps its shape either way: the reusable `perf.yml` runs the bench under
# `continue-on-error` unless the caller asked for `strict`, so a soft run still
# posts the comment and stays green. A strict run, and `lgtm-perf`, go red —
# which is what asking for strictness means.
STATUS=0

# The experiment leg's own verdict, carried to the exit line — see the header of
# section 1 for why this one gates and the control's does not.
if [[ $EXPERIMENT_LEG -ne 0 ]]; then
  STATUS=1
fi

CONTROL_REPORT="$RESULTS_DIR/control/report.json"
EXPERIMENT_REPORT="$RESULTS_DIR/experiment/report.json"

if [[ ! -f "$EXPERIMENT_REPORT" ]]; then
  # No experiment report = nothing to show. Hard fallback.
  STATUS=1
  echo "❌ Experiment report missing — cannot proceed."
  {
    echo "## 🧪 Profiler — re-render regression check"
    echo ""
    echo "❌ **Experiment report missing** — the bench failed to produce data for this PR's branch."
  } > "$RESULTS_DIR/comment.md"
elif [[ ! -f "$CONTROL_REPORT" ]]; then
  # Experiment-only mode: the control leg produced no report, so there is
  # nothing to diff against. The tables are still emitted — `profiler-compare`
  # is run with experiment as *both* sides, which is the only way to print this
  # PR's own measurements — but every delta in them is this run compared with
  # itself, and the banner and the exit status both say so.
  STATUS=1
  echo "❌ Control report missing — nothing was compared. Emitting an experiment-only summary."

  # Banner emits the single `## Profiler …` header (we strip the
  # duplicate that profiler-compare prepends, see the `tail -n +2` below)
  # then the "no baseline" notice, then a separator.
  BASELINE_BANNER="$RESULTS_DIR/baseline-banner.md"
  {
    echo "## 🧪 Profiler — re-render regression check"
    echo ""
    echo "### ❌ No baseline — nothing was compared"
    echo ""
    echo "The control branch (\`$CONTROL_BRANCH\`) produced no report, so this run measured one side only and **is not a pass**. Its leg's own output says why it failed — a branch that predates the instrumentation, an installed \`@abernier/skills\` older than the config copied forward, or an app shell the scripted scenario can't drive."
    echo ""
    echo "The tables below are this PR's standalone measurements, diffed against themselves. Every delta reads 0.0% because both columns are the same run — they are not a comparison. Once a control that can run the bench exists, subsequent PRs get a real diff."
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
  "$ROOT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/profiler.compare.ts" "${COMPARE_ARGS[@]}" || true
  # The comparer prints its own verdict, and here that verdict is a run agreeing
  # with itself. It gets the last word on the console otherwise — which is
  # exactly the `✅ PASS` two repos read as a green bench.
  echo "❌ Nothing was compared — that verdict is this run against itself."
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
  if [[ -n "$STEP_MIN_RENDERS" ]]; then
    COMPARE_ARGS+=(--step-min-renders "$STEP_MIN_RENDERS")
  fi
  if [[ -n "$INCLUDE_EXTERNAL" ]]; then
    COMPARE_ARGS+=("$INCLUDE_EXTERNAL")
  fi
  if [[ -n "$SOFT_FLAG" ]]; then
    COMPARE_ARGS+=("$SOFT_FLAG")
  fi
  # `|| STATUS=$?`, not a bare call: under `--strict` the comparer exits 1 on a
  # regression, and `set -e` would take the script down with it — before the
  # footer that names the commit the numbers belong to, on exactly the runs
  # where someone will want it. The verdict is carried to the exit line instead.
  "$ROOT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/profiler.compare.ts" "${COMPARE_ARGS[@]}" || STATUS=$?
fi

# The repro command is rebuilt from the resolved flags rather than echoed from
# "$@": every one of them changes what the comment says, and `--strict` decides
# whether a regression exits non-zero — a command missing it reproduces the table
# but not the verdict the comment reports. Spelling the defaults out keeps an old
# comment reproducible after a default moves.
REPRO="$SELF --control $CONTROL_BRANCH --threshold $THRESHOLD"
if [[ -z "$SOFT_FLAG" ]]; then
  REPRO+=" --strict"
fi
if [[ -n "$COMPONENT_THRESHOLD" ]]; then
  REPRO+=" --component-threshold $COMPONENT_THRESHOLD"
fi
if [[ -n "$COMPONENT_MIN_RENDERS" ]]; then
  REPRO+=" --component-min-renders $COMPONENT_MIN_RENDERS"
fi
if [[ -n "$STEP_MIN_RENDERS" ]]; then
  REPRO+=" --step-min-renders $STEP_MIN_RENDERS"
fi
if [[ -n "$INCLUDE_EXTERNAL" ]]; then
  REPRO+=" $INCLUDE_EXTERNAL"
fi
if [[ "$CONTROL_CACHE" == "0" ]]; then
  REPRO+=" --no-cache"
fi

# A reader has to be able to tell a baseline that was measured for this run from
# one that was reused, without going and reading the console output of a run
# that has scrolled away. The key is printed with it, because the only question
# worth asking about a reused baseline is what it was keyed on.
if [[ -n "$CONTROL_CACHE_HIT" && -f "$RESULTS_DIR/comment.md" ]]; then
  {
    echo ""
    echo "<sub>Control side reused from cache — \`$CONTROL_BRANCH\` at \`${CONTROL_SHA:0:7}\`, key \`${CACHE_KEY:0:12}\`. Re-measure it with \`PROFILER_CONTROL_CACHE=0\`.</sub>"
  } >> "$RESULTS_DIR/comment.md"
fi

emit_comment_footer "$RESULTS_DIR/comment.md" "$ROOT_DIR" "$REPRO"

echo ""
if [[ -f "$RESULTS_DIR/comment.md" ]]; then
  echo "📄 $RESULTS_DIR/comment.md"
fi

exit $STATUS
