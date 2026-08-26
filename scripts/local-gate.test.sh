#!/usr/bin/env bash
# local-gate.test.sh — what the reporter posts, and what it refuses to do.
#
# The script's whole job is a side effect on someone else's server, so the `gh`
# it calls is injected and every case below asserts on the calls a stub
# recorded. Three things are worth holding: it waits rather than posting into
# the void, it posts exactly once and only after the commit exists, and it
# never exits non-zero — a reporter that failed a push would cost more than the
# red it answers.
set -u

script="$(cd "$(dirname "$0")" && pwd)/local-gate.report.sh"
fails=0

ok() { echo "  ✓ $1"; }
ko() {
  echo "  ✗ $1"
  fails=$((fails + 1))
}

# A `gh` stub that logs every call and reports the commit as missing until the
# Nth `commits/` lookup, which is how a push landing mid-wait is spelled.
make_stub() {
  local dir=$1 found_on=$2
  cat >"$dir/gh" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$dir/calls"
case "\$1 \$2" in
  "repo view") echo "abernier/tilt"; exit 0 ;;
esac
case "\$*" in
  *"commits/"*)
    n=\$(grep -c "commits/" "$dir/calls")
    [ "\$n" -ge $found_on ] && exit 0
    exit 1 ;;
esac
exit 0
STUB
  chmod +x "$dir/gh"
}

run() {
  local dir=$1
  shift
  (
    cd "$dir" || exit 1
    GH="$dir/gh" LOCAL_GATE_TRIES=5 LOCAL_GATE_SLEEP=0 bash "$script" "$@"
  )
}

echo "local-gate.report.sh"

# ---------- posts once the commit has landed ----------
d=$(mktemp -d)
make_stub "$d" 3
run "$d" abc123 "typecheck (mbp2)" "passed before push"
rc=$?
[ "$rc" -eq 0 ] && ok "exits 0" || ko "exits 0 (got $rc)"
posts=$(grep -c "statuses/abc123" "$d/calls" || true)
[ "$posts" -eq 1 ] && ok "posts exactly one status" || ko "posts exactly one status (got $posts)"
grep -q "state=success" "$d/calls" && ok "posts success" || ko "posts success"
grep -q "context=typecheck (mbp2)" "$d/calls" && ok "carries the context" || ko "carries the context"
looks=$(grep -c "commits/abc123" "$d/calls" || true)
[ "$looks" -eq 3 ] && ok "waits for the commit, then stops looking" || ko "waits for the commit (looked $looks times)"
rm -rf "$d"

# ---------- gives up quietly when the commit never lands ----------
d=$(mktemp -d)
make_stub "$d" 99
run "$d" deadbee "typecheck (mbp2)" "never pushed"
rc=$?
[ "$rc" -eq 0 ] && ok "still exits 0 when it gives up" || ko "still exits 0 when it gives up (got $rc)"
posts=$(grep -c "statuses/" "$d/calls" || true)
[ "$posts" -eq 0 ] && ok "posts nothing into the void" || ko "posts nothing into the void (got $posts)"
looks=$(grep -c "commits/" "$d/calls" || true)
[ "$looks" -eq 5 ] && ok "gives up after LOCAL_GATE_TRIES" || ko "gives up after LOCAL_GATE_TRIES (looked $looks)"
rm -rf "$d"

# ---------- refuses to guess ----------
d=$(mktemp -d)
make_stub "$d" 1
run "$d" 2>/dev/null
rc=$?
[ "$rc" -eq 0 ] && ok "exits 0 without arguments" || ko "exits 0 without arguments (got $rc)"
[ ! -s "$d/calls" ] && ok "calls nothing without arguments" || ko "calls nothing without arguments"
rm -rf "$d"

# ---------- survives a machine with no gh ----------
d=$(mktemp -d)
rc=0
(GH="$d/absent-cli" LOCAL_GATE_TRIES=1 LOCAL_GATE_SLEEP=0 bash "$script" abc123 ctx desc) || rc=$?
[ "$rc" -eq 0 ] && ok "exits 0 when gh is absent" || ko "exits 0 when gh is absent (got $rc)"
rm -rf "$d"

echo
if [ "$fails" -eq 0 ]; then
  echo "local-gate: all good"
else
  echo "local-gate: $fails failure(s)"
  exit 1
fi
