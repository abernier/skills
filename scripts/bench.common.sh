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
#   acquire_bench_lock   — take the machine-wide "one bench at a time" lock,
#                          waiting for the bench already holding it.
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

# ── One bench at a time, on the whole machine ────────────────────────────────
#
# There are two reasons to serialise a bench, and they have different scopes.
#
# The narrow one is resources: both harnesses `rm -rf` a results directory and
# bind fixed ports (4200/4201 for tracerbench, 4300/4301 for the profiler), and
# the profiler reuses an already-listening dev server locally, so a second run
# happily benches the *other* branch's code. Those collide only within one repo.
#
# The wide one is the CPU, and it respects no repo boundary: two benchmarks
# sharing a machine measure each other. Measured here — two agents benching two
# unrelated repos at once, different ports, different result directories, no
# resource conflict at all: 3 of 4 control legs died on 120 s Playwright
# timeouts with the load average at 10.96, and a run comparing identical code
# against itself reported +14.5% and breached its own +10% gate. Starvation, not
# collision. Every one of these failures is silent: it produces a plausible
# wrong number rather than an error.
#
# So the lock is machine-wide — `${TMPDIR:-/tmp}/bench.lock`, outside any repo,
# the same path for every repo on the machine. `$TMPDIR` is already per-user on
# macOS, and both it and `/tmp` are cleared on reboot, so no phantom lock
# survives one. `mkdir` is the primitive: on every POSIX filesystem it succeeds
# for exactly one caller, with no window between test and create.
#
# And because the lock now spans repos, a second bench **waits** rather than
# refuses. Refusing was right when the only way to hit it was launching the same
# bench twice; machine-wide it would mean benching one repo kills another repo's
# gate instead of letting it take its turn. The wait is bounded, says who it is
# waiting for, and `BENCH_LOCK_TIMEOUT=0` opts back out into the old refusal —
# for CI, or for anyone who would rather be told than queued.
BENCH_LOCK=""

# How long a bench waits for the one already running, in seconds. Long enough
# for another repo's whole `lgtm-perf` (two benches, four legs) to finish, short
# enough that a wedged bench does not hang a gate for an afternoon.
BENCH_LOCK_TIMEOUT_DEFAULT=1200

# Seconds as a human reads them: `45s`, `2m30s`, `20m0s`.
bench_lock_duration() {
  if (( $1 < 60 )); then echo "$1s"; else echo "$(($1 / 60))m$(($1 % 60))s"; fi
}

# Take the lock — waiting for the bench already holding it — or exit 1.
#
# `BENCH_LOCK_TIMEOUT` (seconds) overrides the bound; `0` refuses immediately
# instead of waiting.
#
# NOTE for callers: this installs an EXIT/INT/TERM trap that releases the lock.
# A script that later sets its own trap replaces it — combine them instead:
#
#   trap 'cleanup; release_bench_lock' EXIT INT TERM
#
# Args:
#   $1 — label naming the holder in the messages (e.g. "tracerbench")
acquire_bench_lock() {
  local label="$1"
  local lock="${TMPDIR:-/tmp}"
  lock="${lock%/}/bench.lock"
  local timeout="${BENCH_LOCK_TIMEOUT:-$BENCH_LOCK_TIMEOUT_DEFAULT}"
  local waited=0 announced=""

  while ! mkdir "$lock" 2>/dev/null; do
    local owner="an unknown run" holder_pid=""
    [[ -r "$lock/owner" ]] && owner="$(cat "$lock/owner")"
    [[ -r "$lock/pid" ]] && holder_pid="$(cat "$lock/pid")"

    # A run killed hard never reaches its teardown, so the directory outlives it
    # holding a pid nobody is running any more. Reclaim it, or one Ctrl-C blocks
    # every future bench until someone deletes a file they have never heard of.
    if [[ -n "$holder_pid" ]] && ! kill -0 "$holder_pid" 2>/dev/null; then
      echo "🧹 Reclaiming a stale bench lock left by $owner"
      rm -rf "$lock"
      mkdir "$lock" 2>/dev/null && break
      # Either someone else won the race for the freed lock, or the directory
      # would not go. Fall through and wait, so a lock that cannot be removed
      # times out rather than spinning here forever.
    fi

    if (( timeout <= 0 )); then
      echo "❌ A bench is already running — $owner"
      echo "   Two benches sharing a machine measure each other, so they run one at a time."
      echo "   Wait for it to finish, or remove $lock if you know it is gone."
      exit 1
    fi

    if (( waited >= timeout )); then
      echo "❌ Gave up after $(bench_lock_duration "$waited") waiting for the bench holding the lock — $owner"
      echo "   It still holds $lock. Stop it, or remove that directory if it is gone."
      exit 1
    fi

    if [[ -z "$announced" ]]; then
      echo "⏳ Waiting for a bench already running — $owner"
      echo "   Two benches sharing a machine measure each other, so they run one at a time,"
      echo "   whichever repo they are in. Waiting up to $(bench_lock_duration "$timeout")."
      announced=1
    elif (( waited % 30 == 0 )); then
      echo "   still waiting after $(bench_lock_duration "$waited") of $(bench_lock_duration "$timeout") — $owner"
    fi

    sleep 1
    waited=$((waited + 1))
  done

  BENCH_LOCK="$lock"
  echo "$label, pid $$, started $(date '+%H:%M:%S')" > "$lock/owner"
  echo "$$" > "$lock/pid"
  if (( waited > 0 )); then
    echo "✅ Took the bench lock after $(bench_lock_duration "$waited")"
  fi
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
# bash die *of* the signal. Every parent up the chain — `bench.lgtm.sh`, pnpm,
# the shell — then sees an interrupt rather than a clean exit, and stops too.
# shellcheck disable=SC2064  # `$fn` must expand now — the handler is a string
trap_teardown() {
  local fn="$1"
  trap "$fn" EXIT
  trap "trap - INT TERM EXIT; $fn; kill -INT \$\$" INT
  trap "trap - INT TERM EXIT; $fn; kill -TERM \$\$" TERM
}
