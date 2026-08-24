#!/usr/bin/env bash
# bench.common.test.sh — teardown, ports, the bench lock and argument parsing.
#
# Scope: the things a bench gets wrong silently. `trap_teardown` is the one that
# looks like it works — `trap f EXIT INT TERM` also runs the teardown, it just
# lets the script walk on to the next stage afterwards, so the test that matters
# is that the run *stops*. `kill_bench_ports` is the same shape: a leftover vite
# server is not an error, it is a plausible wrong number on the next run. The
# bench lock is the same shape again, twice over: without it two runs measure
# each other, and with it a run killed hard would block every later bench. And a
# leading `--` used to abort the invocation both scripts document, so each parser
# is asked to swallow one.
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

# A scratch repository, so the lock under test is never the real one.
lockrepo="$tmp/lockrepo"
mkdir -p "$lockrepo"
git -C "$lockrepo" init --quiet
lockdir="$(git -C "$lockrepo" rev-parse --path-format=absolute --git-common-dir)/bench.lock"

# The lock is only ever taken from a child process: `acquire_bench_lock`
# installs its own EXIT trap, which in this script would replace the one that
# removes "$tmp".
cat > "$tmp/take-lock.sh" <<'INNER'
set -u
script_dir="$1"; repo="$2"; label="$3"; ready="${4:-}"
source "$script_dir/bench.common.sh"
acquire_bench_lock "$repo" "$label"
echo "took the lock"
# A holder has to stay alive, or the next caller reads its pid as dead and
# reclaims the lock as stale — which is a different test.
if [ -n "$ready" ]; then : > "$ready"; sleep 30; fi
INNER

# Start a run that takes the lock and keeps it, and wait until it really has it.
# Sets $holder to its pid.
hold_lock(){
  rm -f "$tmp/held"
  bash "$tmp/take-lock.sh" "$script_dir" "$lockrepo" "$1" "$tmp/held" >/dev/null 2>&1 &
  holder=$!
  for _ in $(seq 1 50); do
    [ -e "$tmp/held" ] && return 0
    sleep 0.1
  done
  return 1
}

if ! hold_lock tracerbench; then
  fail "the bench lock: could not take a first lock to contend with"
else
  out="$(bash "$tmp/take-lock.sh" "$script_dir" "$lockrepo" "profiler" 2>&1)"
  status=$?

  [ "$status" = "1" ] &&
    pass "a second bench refuses to start rather than run alongside the first" ||
    fail "a second bench refuses to start rather than run alongside the first — exit $status"

  case "$out" in
    *"already running"*tracerbench*)
      pass "the refusal names the run holding the lock" ;;
    *)
      fail "the refusal names the run holding the lock — got: $out" ;;
  esac

  kill "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true
fi

# ── A lock left behind by a run that is gone ─────────────────────────────────

# A hard kill never reaches the teardown, so the directory outlives the run,
# holding a pid nobody is running any more. That must be reclaimed, or one
# Ctrl-C blocks every future bench for good.
if ! hold_lock tracerbench; then
  fail "a stale bench lock: could not take a first lock to strand"
else
  # Reap the holder before asking: `kill -0` finds an unreaped child alive.
  kill -9 "$holder" 2>/dev/null || true
  wait "$holder" 2>/dev/null || true

  out="$(bash "$tmp/take-lock.sh" "$script_dir" "$lockrepo" "profiler" 2>&1)"
  status=$?

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
