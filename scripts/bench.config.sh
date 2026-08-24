#!/usr/bin/env bash
# The shell door onto `bench.config.mjs`, which is the one reader of `bench.json`.
# Source-able only — do not execute directly.
#
# What the keys mean, which have defaults and why the rest deliberately do not,
# all live in `bench.config.mjs`. The one rule worth repeating on this side,
# because it is what the call sites below rely on: **a key that is absent does
# not disable a mechanism, it just adds nothing to it.** An absent scalar is the
# module's default, or the caller's `$2`, or empty; an absent list is no lines.
#
# Functions exposed:
#
#   bench_config       — one scalar, or the default when the key is unset.
#   bench_config_list  — zero or more values, one per line; nothing when unset.
#
# Both resolve `$ROOT_DIR/bench.json`, so `ROOT_DIR` must be set before this
# file is sourced — and `ROOT_DIR` is the repository being measured, never the
# directory this harness is installed in.
#
# One `node` per sourcing script, not one per key. The reader is asked for the
# whole resolved config once, here, and the two functions answer from that in
# pure bash. Reading a key costs nothing after this line, so a caller is free to
# ask for as many as it needs.
#
# This is also the parse-check, and it covers every caller by construction:
# there is no path to a value that does not go through it. A `bench.json` that
# does not parse prints the error and stops the bench, rather than silently
# handing back defaults and benching the wrong thing.
_BENCH_CONFIG="$(
  node "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/bench.config.mjs" \
    "$ROOT_DIR"
)" || exit 1

# One scalar value. `$2` is the default, used when the key has none of its own
# in `bench.config.mjs` and the config does not declare it.
bench_config() {
  local key value
  while IFS=$'\t' read -r key value; do
    if [ "$key" = "$1" ]; then
      printf '%s\n' "$value"
      return 0
    fi
  done <<< "$_BENCH_CONFIG"
  printf '%s\n' "${2:-}"
}

# Zero or more values, one per line. An absent file, an absent key or an empty
# list all yield no lines, so `while read` around it runs zero times.
bench_config_list() {
  local key value
  while IFS=$'\t' read -r key value; do
    if [ "$key" = "$1" ]; then
      printf '%s\n' "$value"
    fi
  done <<< "$_BENCH_CONFIG"
  return 0
}
