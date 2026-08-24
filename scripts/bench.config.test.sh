#!/usr/bin/env bash
# bench.config.test.sh — the shell door onto `bench.json`.
#
# Scope: the four answers a bench actually depends on, driven through
# `bench.config.sh` in a real subshell against a real config file, because that
# is the whole path a bench takes — `bench.config.mjs` resolving the file, the
# door reading it once, the two functions answering from it.
#
# The one that matters most is the malformed file. Every other case here is
# visible the moment a bench runs; a `bench.json` with a stray comma that
# silently fell back to the defaults would keep benching, keep passing, and
# measure something nobody asked for.
set -u

# This suite stands inside the repository it must not touch and points the
# reader at scratch directories instead. `ROOT_DIR` is read out of the
# environment by the file under test, and GIT_DIR and friends beat `cwd` for
# anything that asks git — a git hook exports them, and `cd` does not escape
# them. Drop every repo-local git variable once, for this script and everything
# it runs.
# shellcheck disable=SC2046  # intentional word-splitting of the var-name list
unset $(git rev-parse --local-env-vars)

script_dir="$(cd "$(dirname "$0")" && pwd)"
fails=0
pass(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail(){ printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Every case is a fresh `bash -c`: sourcing happens once per shell, and the
# whole point of the door is that the file is read at that moment.
ask(){
  local root="$1"; shift
  ROOT_DIR="$root" bash -c '
    source "$1/bench.config.sh"
    shift
    "$@"
  ' _ "$script_dir" "$@" 2>&1
}

echo "bench config:"

# ── A repo with no bench.json ────────────────────────────────────────────────

mkdir -p "$tmp/plain"

out="$(ask "$tmp/plain" bench_config sourceRoots)"
[ "$out" = "src" ] &&
  pass "an absent file gives the default" ||
  fail "an absent file gives the default — got: $out"

out="$(ask "$tmp/plain" bench_config_list workspacePackages)"
[ -z "$out" ] &&
  pass "an absent list key gives no lines" ||
  fail "an absent list key gives no lines — got: $out"

# ── A repo that declares some of it ──────────────────────────────────────────

mkdir -p "$tmp/declared"
cat > "$tmp/declared/bench.json" <<'JSON'
{
  "sourceRoots": ["packages/www/src", "packages/ds/src"],
  "workspacePackages": ["packages/ds"],
  "thresholds": { "tracerbenchMs": 12 }
}
JSON

out="$(ask "$tmp/declared" bench_config_list sourceRoots)"
[ "$out" = "packages/www/src
packages/ds/src" ] &&
  pass "a list key gives one line per element, in order" ||
  fail "a list key gives one line per element, in order — got: $out"

out="$(ask "$tmp/declared" bench_config thresholds.tracerbenchMs)"
[ "$out" = "12" ] &&
  pass "a nested key is reached by its dotted name" ||
  fail "a nested key is reached by its dotted name — got: $out"

# The absent-key contract, on the key that decides whether a gate exists at all.
out="$(ask "$tmp/declared" bench_config thresholds.tracerbenchFrames)"
[ -z "$out" ] &&
  pass "a threshold the config does not declare stays empty — no invented gate" ||
  fail "a threshold the config does not declare stays empty — got: $out"

# A key the config says nothing about still falls back to the reader's default,
# not to whatever the neighbouring keys made it look like.
out="$(ask "$tmp/declared" bench_config distDir)"
[ "$out" = "dist" ] &&
  pass "a key a partial config omits still gets its default" ||
  fail "a key a partial config omits still gets its default — got: $out"

# The caller's own `$2`, for a key with no default of its own.
out="$(ask "$tmp/declared" bench_config thresholds.tracerbenchFrames 30)"
[ "$out" = "30" ] &&
  pass "the caller's fallback stands in for a key with no default" ||
  fail "the caller's fallback stands in for a key with no default — got: $out"

# ── A repo whose bench.json does not parse ───────────────────────────────────

mkdir -p "$tmp/broken"
printf '{ "sourceRoots": ["src"], }\n' > "$tmp/broken/bench.json"

out="$(ask "$tmp/broken" bench_config sourceRoots)"
status=$?

[ "$status" != "0" ] &&
  pass "a malformed bench.json fails the run" ||
  fail "a malformed bench.json fails the run — exited 0 with: $out"

case "$out" in
  *"$tmp/broken/bench.json"*) pass "a malformed bench.json says which file, on stderr" ;;
  *) fail "a malformed bench.json says which file — got: $out" ;;
esac

# The check has to cover the list readers too. A caller that only reads lists
# would otherwise never tell an absent file from a mistyped one, and quietly
# bench the wrong thing.
out="$(ask "$tmp/broken" bench_config_list workspacePackages)"
[ "$?" != "0" ] &&
  pass "a malformed bench.json fails a list caller too" ||
  fail "a malformed bench.json fails a list caller too — exited 0 with: $out"

[ "$fails" -eq 0 ] && echo "bench config ✓" || { echo "$fails failed ✗"; exit 1; }
