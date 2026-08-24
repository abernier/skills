#!/usr/bin/env bash
# Per-repo values for the benches, read from `bench.json` at the repo root.
# Source-able only — do not execute directly.
#
# The benches are the same everywhere this harness runs; the paths and gate
# widths they work with are not. Those are values, not forks in the code, so
# `tracerbench.sh`, `profiler.sh` and `profiler-compare.ts` stay identical
# across repos and only the JSON differs.
#
# At the root, not under `.claude/`: this is committed repo config, read by six
# plain node/bash bins with no agent in the loop, so it belongs next to
# `tsconfig.json` and `package.json`. `.claude/` is Claude Code's own directory,
# and an un-namespaced file squatting in it reads as a native feature it is not.
#
# Defaults are the single-package case — one `src`, one `dist`, no workspace
# packages — so a repo shaped like that needs no config file at all. Every key
# is optional, and a key that is absent does not disable a mechanism, it just
# adds nothing to it.
#
# Functions exposed:
#
#   bench_config       — one scalar, or the default when the key is unset.
#   bench_config_list  — zero or more values, one per line; nothing when unset.
#
# Both resolve `$ROOT_DIR/bench.json`, so `ROOT_DIR` must be set before
# they are called — and `ROOT_DIR` is the repository being measured, never the
# directory this harness is installed in. `node` rather than `jq`: no repo can
# assume jq, and all of them already require node to run a bench at all.
#
# Keys, all optional:
#
#   sourceRoots          where the app's own components live, repo-relative
#                        (profiler-compare, for "is this mine to fix")
#   shadcnUiRoot         vendored shadcn primitives — never actionable
#   workspacePackages    packages whose own node_modules a control worktree
#                        needs symlinked alongside the root one
#   distDir              where `pnpm run build` leaves the bundle
#   controlWorktreeCopy  extra repo-relative files the control worktree needs,
#                        on top of the ones every repo copies
#   thresholds.tracerbenchMs      wall-clock regression gate, percent
#   thresholds.tracerbenchFrames  rendered-frames gate, percent
#   thresholds.localTracerbenchMs      the same two, for `lgtm-perf.sh` — the
#   thresholds.localTracerbenchFrames  local gate, deliberately tighter than
#                                      the one CI runs

# One scalar value. `$2` is the default, used when the file or the key is
# absent. A file that exists but does not parse is an error, not a default: a
# typo there would otherwise silently change what the gate measures.
bench_config() {
  node -e '
    const fs = require("node:fs");
    const [file, key, fallback] = process.argv.slice(1);
    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error(`bench config: ${file}: ${err.message}`);
        process.exit(1);
      }
    }
    const value = key.split(".").reduce((o, k) => (o ?? {})[k], cfg);
    console.log(value ?? fallback);
  ' "$ROOT_DIR/bench.json" "$1" "${2:-}"
}

# Zero or more values, one per line. An absent file, an absent key or an empty
# list all yield no lines, so `while read` around it runs zero times.
bench_config_list() {
  node -e '
    const fs = require("node:fs");
    const [file, key] = process.argv.slice(1);
    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error(`bench config: ${file}: ${err.message}`);
        process.exit(1);
      }
    }
    const value = key.split(".").reduce((o, k) => (o ?? {})[k], cfg);
    for (const v of value ?? []) console.log(v);
  ' "$ROOT_DIR/bench.json" "$1"
}

# Catch a config that does not parse once, when this file is sourced. The
# readers above each treat an absent file as "use the defaults", and a caller
# that only reads lists would otherwise never notice the difference between an
# absent file and a mistyped one — and quietly bench the wrong thing.
if [ -f "$ROOT_DIR/bench.json" ]; then
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`bench config: ${file}: ${err.message}`);
      process.exit(1);
    }
  ' "$ROOT_DIR/bench.json"
fi
