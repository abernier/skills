#!/usr/bin/env bash
# The uppercase gate: the fast suite, then the slow one. Its own script for one
# reason — Ctrl-C.
#
# `pnpm run lgtm && bash scripts/bench.e2e.test.sh` in package.json looks like a
# chain an interrupt stops, and it is not: `pnpm run` catches SIGINT, kills what
# it started, and exits 0. `&&` reads that as success and starts the next leg,
# so stopping the gate took one Ctrl-C per leg. Measured — and it is pnpm doing
# it, not concurrently, which dies of the signal like everything else.
#
# A script can hold a trap. Bash defers the signal until the running leg
# returns, then runs the handler, which disarms and re-raises so bash dies *of*
# the interrupt, and the chain never reaches the next leg.
#
# The outermost `pnpm run LGTM` still reports 0 for the same reason it did
# before — that is pnpm's own doing and nothing downstream reads it. What
# mattered was that the gate stops on the first Ctrl-C, and it does.
#
# The shape is the consuming repos' (`tilt`, `sizematters`) verbatim, which is
# the point: the gate the plugin recommends is the gate the plugin runs.
set -euo pipefail

trap 'trap - INT TERM; kill -INT $$' INT
trap 'trap - INT TERM; kill -TERM $$' TERM

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# typecheck, the emitted declarations, shellcheck, and the fast suite —
# everything the lowercase gate already covers, in about a minute.
pnpm run lgtm

# The one leg that needs a browser, a build and a couple of minutes: both
# benches driven end to end against a real React app. Deliberately not in
# `lgtm`, which runs before every commit and has to stay fast.
bash scripts/bench.e2e.test.sh
