#!/usr/bin/env bash
# Shared helpers for the scripts that post a markdown comment on a PR
# (tracerbench, profiler). Source-able only — do not execute
# directly. Functions exposed:
#
#   default_control      — resolve the control branch (PR base / gh / main).
#   emit_comment_footer  — append a "Data for <SHA>" footer to a markdown
#                          comment, linking to the commit + run when running in
#                          GitHub Actions, and naming the command that
#                          reproduces the numbers locally.
#   acquire_bench_lock   — take the repository-wide "one bench at a time" lock.
#   release_bench_lock   — give it back.
#   kill_bench_ports     — free the ports this bench binds, whatever holds them.
#   trap_teardown        — install teardown traps that actually stop the script.
#
# The title is each script's own — several of them build it inside a TypeScript
# comparer, so there is nothing to call here — but the shape is shared, and a
# reader scanning a PR reads the two as one family:
#
#   ## <emoji> <Report> — <what it measures>
#
#   ## 📊 TracerBench — mark duration comparison
#   ## 🧪 Profiler — re-render regression check
#
# Level 2, one distinct emoji each, and the clause after the dash says what the
# numbers are, not what the tool is.

# Resolve the default control branch when `--control` is not provided.
# Probes in order:
#   1. $GITHUB_BASE_REF — auto-set by GitHub Actions on `pull_request` events
#   2. `gh pr view`     — locally, when authenticated and on a PR-tracked branch
#   3. main             — final fallback
default_control() {
  if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    echo "$GITHUB_BASE_REF"; return
  fi
  if command -v gh >/dev/null 2>&1; then
    local detected
    detected=$(gh pr view --json baseRefName --jq .baseRefName 2>/dev/null || true)
    if [[ -n "$detected" ]]; then echo "$detected"; return; fi
  fi
  echo "main"
}

# Append a small footer to a markdown comment that identifies the exact
# commit the bench was run for. In GitHub Actions, the SHA and run-id are
# turned into links to the commit page and the workflow run; locally, only
# the SHA is shown.
#
# A reader who doubts a number should be able to re-run it without reverse-
# engineering the workflow file, so the footer also carries the exact local
# command — `bash <path to the script>`, never `pnpm run … -- --flag`, which
# forwards the literal `--` and dies on "Unknown option". The caller builds that
# path: this harness lives in the repo's `node_modules`, so where it sits
# relative to the repo root is the package manager's business, not this file's.
#
# Args:
#   $1 — path to the markdown comment file (must already exist)
#   $2 — path to the root of the repo being measured (resolves the git revision)
#   $3 — command reproducing this run locally (optional)
emit_comment_footer() {
  local comment_file="$1"
  local root_dir="$2"
  local repro_cmd="${3:-}"
  [[ -f "$comment_file" ]] || return 0

  local sha_short sha_full
  sha_short="$(git -C "$root_dir" rev-parse --short HEAD)"
  sha_full="$(git -C "$root_dir" rev-parse HEAD)"

  # The commit reads as a link only under GitHub Actions, where the server and
  # repository are known.
  local sha_md="\`${sha_short}\`" run_md=""
  if [[ -n "${GITHUB_SERVER_URL:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
    sha_md="[\`${sha_short}\`](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/commit/${sha_full})"
    if [[ -n "${GITHUB_RUN_ID:-}" ]]; then
      run_md=" — [view run](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID})"
    fi
  fi

  {
    echo ""
    echo "---"
    echo ""
    if [[ -n "$repro_cmd" ]]; then
      echo "<sub>Reproduce locally with \`${repro_cmd}\`.</sub>"
      echo ""
    fi
    echo "<sub>Data for ${sha_md}${run_md}.</sub>"
  } >> "$comment_file"
}

# ── One bench at a time ──────────────────────────────────────────────────────
#
# Both harnesses `rm -rf` a results directory and bind fixed ports (4200/4201
# for tracerbench, 4300/4301 for the profiler). Two runs at once therefore
# delete each other's reports and measure each other's CPU — and the profiler
# reuses an already-listening dev server locally, so the second run happily
# benches the *other* branch's code. Every one of those failures is silent: it
# produces a plausible wrong number rather than an error.
#
# So a bench takes an exclusive lock first, and refuses to start rather than
# corrupt a run in flight. `mkdir` is the primitive: on every POSIX filesystem
# it succeeds for exactly one caller, with no window between test and create.
#
# The lock lives in the *common* git directory, which every worktree of the
# repository shares — the ports do not care which worktree bound them, so
# neither can the lock. That also keeps it out of the working tree, so there is
# nothing to gitignore.
BENCH_LOCK=""

# Take the lock, or exit 1 explaining who holds it.
#
# NOTE for callers: this installs an EXIT/INT/TERM trap that releases the lock.
# A script that later sets its own trap replaces it — combine them instead:
#
#   trap 'cleanup; release_bench_lock' EXIT INT TERM
#
# Args:
#   $1 — path to the repo root
#   $2 — label naming the holder in the refusal message (e.g. "tracerbench")
acquire_bench_lock() {
  local root_dir="$1"
  local label="$2"
  local lock
  lock="$(git -C "$root_dir" rev-parse --path-format=absolute --git-common-dir)/bench.lock"

  if ! mkdir "$lock" 2>/dev/null; then
    local owner="an unknown run" holder_pid=""
    [[ -r "$lock/owner" ]] && owner="$(cat "$lock/owner")"
    [[ -r "$lock/pid" ]] && holder_pid="$(cat "$lock/pid")"

    # A run killed hard leaves the directory behind. Reclaim it, or one Ctrl-C
    # blocks every future bench until someone deletes a file they have never
    # heard of.
    if [[ -n "$holder_pid" ]] && ! kill -0 "$holder_pid" 2>/dev/null; then
      echo "🧹 Reclaiming a stale bench lock left by $owner"
      rm -rf "$lock"
      mkdir "$lock" 2>/dev/null || {
        echo "❌ Could not take the bench lock at $lock"
        exit 1
      }
    else
      echo "❌ A bench is already running — $owner"
      echo "   Benches share ports and result directories, so they run one at a time."
      echo "   Wait for it to finish, or remove $lock if you know it is gone."
      exit 1
    fi
  fi

  BENCH_LOCK="$lock"
  echo "$label, pid $$, started $(date '+%H:%M:%S')" > "$lock/owner"
  echo "$$" > "$lock/pid"
  trap release_bench_lock EXIT INT TERM
}

# Give the lock back. Idempotent: safe to call from a trap that also fires
# after an explicit call.
release_bench_lock() {
  [[ -n "$BENCH_LOCK" ]] || return 0
  rm -rf "$BENCH_LOCK"
  BENCH_LOCK=""
}

# ── Ports left behind ────────────────────────────────────────────────────────

# Free the ports this bench binds, whatever is still holding them.
#
# Playwright starts its web server in a process group of its own (`detached`),
# so Ctrl-C never reaches it: the terminal signals only the foreground group,
# and the server dies from Playwright's own teardown or not at all. That
# teardown loses the race whenever Playwright is killed alongside its parents —
# measured on this repo, the bench tree sat in one process group and the vite
# server in another.
#
# What survives is a vite server on a fixed port, and it is not a cosmetic
# leftover: the next tracerbench run dies on `--strictPort`, and the next
# profiler run *silently reuses it* (`reuseExistingServer` is on locally) and
# benches whatever branch that server was serving.
#
# Scoped to ports on purpose. A leftover headless Chromium costs memory but
# blocks nothing, and nothing distinguishes it from another project's run.
#
# Args: the ports this bench binds.
kill_bench_ports() {
  local port pids
  for port in "$@"; do
    pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -n "$pids" ]] || continue

    echo "🧹 Freeing port $port"
    # shellcheck disable=SC2086  # word splitting is what turns lsof's lines into args
    kill $pids 2>/dev/null || true
    sleep 1

    pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  done
  return 0
}

# ── Interrupting a bench ─────────────────────────────────────────────────────

# Install `$1` as the teardown, on a normal exit and on an interrupt alike.
#
#   trap_teardown bench_teardown
#
# `trap bench_teardown EXIT INT TERM` looks like it does this and does not:
# bash runs an INT handler and then **resumes the script where it left off**.
# Under that trap a Ctrl-C tore the control worktree down and the bench walked
# on to the next stage, so interrupting a run took one Ctrl-C per stage — and
# once the teardown also freed ports and released the lock, the first Ctrl-C
# pulled the server out from under a Playwright that was still running.
#
# So on a signal: disarm the traps, tear down once, and re-raise, which makes
# bash die *of* the signal. Every parent up the chain — `lgtm-perf.sh`, pnpm,
# the shell — then sees an interrupt rather than a clean exit, and stops too.
# shellcheck disable=SC2064  # `$fn` must expand now — the handler is a string
trap_teardown() {
  local fn="$1"
  trap "$fn" EXIT
  trap "trap - INT TERM EXIT; $fn; kill -INT \$\$" INT
  trap "trap - INT TERM EXIT; $fn; kill -TERM \$\$" TERM
}
