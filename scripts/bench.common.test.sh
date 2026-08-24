#!/usr/bin/env bash
# bench.common.test.sh — teardown, ports, the bench lock and argument parsing.
#
# Scope: the things a bench gets wrong silently. `trap_teardown` is the one that
# looks like it works — `trap f EXIT INT TERM` also runs the teardown, it just
# lets the script walk on to the next stage afterwards, so the test that matters
# is that the run *stops*. `kill_bench_ports` is the same shape: a leftover vite
# server is not an error, it is a plausible wrong number on the next run. The
# bench lock is the same shape again, three times over: without it two runs
# measure each other, with it a run killed hard would block every later bench,
# and now that it spans the machine rather than one repo, the run it turns away
# has to be allowed to take its turn instead. And a leading `--` used to abort
# the invocation both scripts document, so each parser is asked to swallow one.
#
# What is not here: the benches themselves. They build, serve and drive a
# browser for minutes — the harness around them is what this covers.
set -u

# This suite runs from inside the repository it must not touch, and the lock
# cases below `git init` a scratch repo and ask git where its common directory
# is. Both read GIT_DIR and friends out of the environment; a git hook exports
# them, and `cd` into a temp dir does NOT escape them. Unscrubbed, that `git
# init` addresses the REAL repository and sets core.bare=true on it, and the
# lock under test becomes the real one. Drop every repo-local git variable once,
# for this script and for everything it runs.
# shellcheck disable=SC2046  # intentional word-splitting of the var-name list
unset $(git rev-parse --local-env-vars)

# The harness under test is this script's own siblings, not anything in the
# repository it happens to run from — so this resolves the *package* directory.
# The repo root the benches measure is a separate thing they derive themselves.
script_dir="$(cd "$(dirname "$0")" && pwd)"
fails=0
pass(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail(){ printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }

# shellcheck source=./bench.common.sh
source "$script_dir/bench.common.sh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The bench lock lives at `${TMPDIR:-/tmp}/bench.lock` — one path for the whole
# machine, which is the point of it. That also means this suite would contend
# with any real bench running here, and with a second copy of itself. Point
# TMPDIR at this run's scratch directory and the lock under test is private to
# it, while still being exactly the path the harness computes.
export TMPDIR="$tmp"

echo "bench harness:"

# ── trap_teardown ────────────────────────────────────────────────────────────

# A bench in miniature: two stages, a teardown, and a Ctrl-C in between. The
# signal is sent to the script's own pid, which is what a Ctrl-C delivers to
# every process in the foreground group.
cat > "$tmp/bench.sh" <<'INNER'
set -u
script_dir="$1"; log="$2"; mode="${3:-}"
source "$script_dir/bench.common.sh"
teardown(){ echo "teardown" >> "$log"; }
trap_teardown teardown
echo "stage 1" >> "$log"
if [[ "$mode" == "--interrupt" ]]; then kill -INT $$; fi
echo "stage 2" >> "$log"
INNER

log="$tmp/interrupted.log"
bash "$tmp/bench.sh" "$script_dir" "$log" --interrupt >/dev/null 2>&1
status=$?
trace="$(tr '\n' ' ' < "$log")"

[ "$status" = "130" ] &&
  pass "an interrupt kills the bench with the signal (130), not a clean exit" ||
  fail "an interrupt kills the bench with the signal (130), not a clean exit — got $status"

case "$trace" in
  *"stage 2"*) fail "an interrupt stops the bench — it ran the next stage anyway" ;;
  *) pass "an interrupt stops the bench before the next stage" ;;
esac

[ "$(grep -c '^teardown$' "$log")" = "1" ] &&
  pass "an interrupt tears down exactly once" ||
  fail "an interrupt tears down exactly once — got $(grep -c '^teardown$' "$log")"

log="$tmp/normal.log"
bash "$tmp/bench.sh" "$script_dir" "$log" >/dev/null 2>&1
status=$?
[ "$status" = "0" ] && [ "$(grep -c '^teardown$' "$log")" = "1" ] &&
  pass "a normal run reaches the end and still tears down once" ||
  fail "a normal run reaches the end and still tears down once — exit $status, $(grep -c '^teardown$' "$log") teardown(s)"

# ── kill_bench_ports ─────────────────────────────────────────────────────────

if command -v lsof >/dev/null 2>&1; then
  # A server on an ephemeral port, standing in for the vite server Playwright
  # leaves behind. It reports the port it got, so the test never guesses one.
  node -e '
    const s = require("http").createServer();
    s.listen(0, () => require("fs").writeFileSync(process.argv[1], String(s.address().port)));
    setTimeout(() => process.exit(1), 30000);
  ' "$tmp/port" &
  holder=$!

  port=""
  for _ in $(seq 1 50); do
    [ -s "$tmp/port" ] && port="$(cat "$tmp/port")" && break
    sleep 0.1
  done

  if [ -z "$port" ]; then
    fail "kill_bench_ports: could not start a server to free"
  else
    kill_bench_ports "$port" >/dev/null 2>&1
    if [ -z "$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null)" ]; then
      pass "kill_bench_ports frees a port someone else's process group is holding"
    else
      fail "kill_bench_ports frees a port someone else's process group is holding — $port still listening"
    fi
  fi
  kill "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true
else
  echo "  (lsof absent — kill_bench_ports skipped)"
fi

# ── The bench lock ───────────────────────────────────────────────────────────

# Two scratch repositories, because the lock is about the machine and not about
# either of them: `repo_a` stands for `tilt`, `repo_b` for `sizematters`. Their
# ports and result directories never collide — the CPU they are both timing is
# what does, and that is what the lock is now for.
repo_a="$tmp/repo-a"
repo_b="$tmp/repo-b"
for repo in "$repo_a" "$repo_b"; do
  mkdir -p "$repo"
  git -C "$repo" init --quiet
done
lockdir="$tmp/bench.lock"

# The lock is only ever taken from a child process: `acquire_bench_lock`
# installs its own EXIT trap, which in this script would replace the one that
# removes "$tmp".
#
# It `cd`s into the repo first, so a lock that went back to being per-repo would
# be a different one for `repo_a` and `repo_b` — which is exactly what the
# cross-repo cases below would then catch.
cat > "$tmp/take-lock.sh" <<'INNER'
set -u
script_dir="$1"; repo="$2"; label="$3"; ready="${4:-}"
source "$script_dir/bench.common.sh"
cd "$repo" || exit 1
acquire_bench_lock "$label"
# What both benches do with the lock they just took, and what makes a TERM here
# mean "this bench finished" rather than "this bench ignored you": `trap
# release_bench_lock EXIT INT TERM` runs the handler and then walks on.
trap_teardown release_bench_lock
echo "took the lock"
# A holder has to stay alive, or the next caller reads its pid as dead and
# reclaims the lock as stale — which is a different test. It sleeps in short
# slices rather than one long one: bash defers a trap until the foreground
# command returns, so a `sleep 30` would sit on the TERM that the "waits, then
# proceeds" case uses to hand the lock over.
if [ -n "$ready" ]; then
  : > "$ready"
  for _ in $(seq 1 300); do sleep 0.1; done
fi
INNER

# Start a run that takes the lock and keeps it, and wait until it really has it.
# Sets $holder to its pid.
#
# Args: the repo it runs from, and the label it takes the lock under.
hold_lock(){
  rm -f "$tmp/held"
  bash "$tmp/take-lock.sh" "$script_dir" "$1" "$2" "$tmp/held" >/dev/null 2>&1 &
  holder=$!
  for _ in $(seq 1 50); do
    [ -e "$tmp/held" ] && return 0
    sleep 0.1
  done
  return 1
}

# Run a contender with a watchdog, and set $status and $out.
#
# The watchdog is the point: "gives up at the bound" is an assertion about a
# wait that ends, and a suite that simply blocked forever would be indis-
# tinguishable from one that passed it. A run still alive at the limit is killed
# and reported as 124, which no assertion below accepts.
#
# Args: the limit in seconds, then the command.
run_contender(){
  local limit="$1"; shift
  local out_file="$tmp/contender.out" pid ticks=0
  "$@" > "$out_file" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$ticks" -ge "$((limit * 10))" ]; then
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      status=124
      out="$(cat "$out_file")"
      return 0
    fi
    sleep 0.1
    ticks=$((ticks + 1))
  done
  wait "$pid"
  status=$?
  out="$(cat "$out_file")"
}

# ── Fail fast, when that is what the caller asked for ────────────────────────

# `BENCH_LOCK_TIMEOUT=0` is the way back to the old behaviour — CI, or anyone
# who would rather be told than queued behind a run they did not start.
if ! hold_lock "$repo_a" tracerbench; then
  fail "the bench lock: could not take a first lock to contend with"
else
  run_contender 15 env BENCH_LOCK_TIMEOUT=0 \
    bash "$tmp/take-lock.sh" "$script_dir" "$repo_a" "profiler"

  [ "$status" = "1" ] &&
    pass "BENCH_LOCK_TIMEOUT=0 refuses instead of waiting" ||
    fail "BENCH_LOCK_TIMEOUT=0 refuses instead of waiting — exit $status: $out"

  case "$out" in
    *"already running"*tracerbench*)
      pass "the refusal names the run holding the lock" ;;
    *)
      fail "the refusal names the run holding the lock — got: $out" ;;
  esac

  # ── The other repo ─────────────────────────────────────────────────────────
  #
  # The case this lock exists for. `repo_b` shares nothing with `repo_a` — not a
  # port, not a result directory, not a git directory — and must still see the
  # bench running in it. Measured on 2026-08-24, benching both at once starved
  # 3 of 4 control legs into 120 s Playwright timeouts and reported +14.5% on
  # identical code.
  run_contender 15 env BENCH_LOCK_TIMEOUT=0 \
    bash "$tmp/take-lock.sh" "$script_dir" "$repo_b" "profiler"

  case "$out" in
    *"already running"*tracerbench*)
      pass "a bench in another repo sees the one already running" ;;
    *)
      fail "a bench in another repo sees the one already running — exit $status: $out" ;;
  esac

  kill "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true
fi

# ── Waiting for its turn ─────────────────────────────────────────────────────

# The default. Refusing is right for one repo launched twice and wrong across
# repos, where it would kill the second repo's gate for the crime of sharing a
# machine. So the second run queues, says what it is queueing behind, and starts
# when the first one is done.
rm -rf "$lockdir"
if ! hold_lock "$repo_a" tracerbench; then
  fail "waiting for the lock: could not take a first lock to wait on"
else
  # The holder gives the lock back on a TERM, through the teardown trap
  # `acquire_bench_lock` installs — a bench finishing, in miniature.
  ( sleep 2; kill "$holder" 2>/dev/null || true ) &
  releaser=$!

  run_contender 30 env BENCH_LOCK_TIMEOUT=25 \
    bash "$tmp/take-lock.sh" "$script_dir" "$repo_b" "profiler"

  wait "$releaser" 2>/dev/null || true
  kill "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true

  case "$out" in
    *"Waiting for a bench already running"*tracerbench*)
      pass "a bench that has to wait says what it is waiting for" ;;
    *)
      fail "a bench that has to wait says what it is waiting for — got: $out" ;;
  esac

  [ "$status" = "0" ] &&
    pass "and it runs once the other repo's bench gives the lock back" ||
    fail "and it runs once the other repo's bench gives the lock back — exit $status: $out"

  case "$out" in
    *"took the lock"*) pass "and it really got the lock, rather than skipping it" ;;
    *) fail "and it really got the lock, rather than skipping it — got: $out" ;;
  esac
fi

# ── The bound ────────────────────────────────────────────────────────────────

# An unbounded wait turns a wedged bench into a hung gate, so the wait ends —
# with a message, and non-zero. Two seconds here, twenty minutes in a real run;
# the behaviour is the same and the suite stays fast.
rm -rf "$lockdir"
if ! hold_lock "$repo_a" tracerbench; then
  fail "the wait's bound: could not take a first lock to wait on"
else
  run_contender 20 env BENCH_LOCK_TIMEOUT=2 \
    bash "$tmp/take-lock.sh" "$script_dir" "$repo_b" "profiler"

  [ "$status" = "1" ] &&
    pass "a wait that reaches its bound gives up rather than hanging" ||
    fail "a wait that reaches its bound gives up rather than hanging — exit $status: $out"

  case "$out" in
    *"Gave up after"*tracerbench*)
      pass "and it says how long it waited and who it waited for" ;;
    *)
      fail "and it says how long it waited and who it waited for — got: $out" ;;
  esac

  kill "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true
fi

# ── A lock left behind by a run that is gone ─────────────────────────────────

# A hard kill never reaches the teardown, so the directory outlives the run,
# holding a pid nobody is running any more. That must be reclaimed, or one
# Ctrl-C blocks every future bench for good — and now for every repo on the
# machine, so it is reclaimed from the other one.
rm -rf "$lockdir"
if ! hold_lock "$repo_a" tracerbench; then
  fail "a stale bench lock: could not take a first lock to strand"
else
  # Reap the holder before asking: `kill -0` finds an unreaped child alive.
  kill -9 "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true

  run_contender 15 bash "$tmp/take-lock.sh" "$script_dir" "$repo_b" "profiler"

  [ "$status" = "0" ] &&
    pass "a lock left behind by a dead run is reclaimed, not waited on forever" ||
    fail "a lock left behind by a dead run is reclaimed, not waited on forever — exit $status: $out"

  case "$out" in
    *"Reclaiming a stale bench lock"*) pass "reclaiming a stale lock says so" ;;
    *) fail "reclaiming a stale lock says so — got: $out" ;;
  esac

  # The reclaiming run has exited, so its own teardown should have given the
  # lock back — otherwise every reclaim just plants the next stale lock.
  [ ! -d "$lockdir" ] &&
    pass "a bench gives the lock back when it exits" ||
    fail "a bench gives the lock back when it exits — $lockdir still there"
fi

# ── The documented invocation ────────────────────────────────────────────────

# `pnpm run tracerbench -- --control x` forwards the `--`, so both parsers must
# swallow it. Asking for an option that does not exist proves the parser got
# past the `--` and stops the script before it builds anything.
swallows_dashdash(){
  local out
  out="$(GITHUB_BASE_REF=main bash "$script_dir/$1" -- --no-such-option 2>&1)"
  case "$out" in
    *"Unknown option: --no-such-option"*) pass "$1 swallows the \`--\` pnpm forwards" ;;
    *"Unknown option: --"*) fail "$1 swallows the \`--\` pnpm forwards — died on the \`--\` itself" ;;
    *) fail "$1 swallows the \`--\` pnpm forwards — unexpected output: $out" ;;
  esac
}

swallows_dashdash tracerbench.sh
swallows_dashdash profiler.sh

[ "$fails" -eq 0 ] && echo "bench harness ✓" || { echo "$fails failed ✗"; exit 1; }
