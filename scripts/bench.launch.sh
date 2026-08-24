#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# The one launcher behind the three `.ts` bin entries. Sourced, never executed:
#
#   source .../bench.launch.sh <bin-name> <program.ts> "$@"
#
# `tracerbench.compare.sh`, `profiler.compare.sh` and `profiler.aggregate.sh`
# are that line and nothing else. They exist because `bin` needs three distinct
# paths, and because pnpm installs a `.sh` bin as a shim that `exec`s the target
# file rather than as a symlink named after the command — verified on pnpm
# 10.33.4, where two bins pointing at one file both report that file in `$0`.
# So `$0` cannot tell one launcher which program it is, and the name has to be
# written down. Three doors is the floor, not a leftover.
#
# The bin cannot point at the `.ts` file directly: it needs a TypeScript loader,
# and the one this harness uses is deliberately the measured repo's own `tsx`. A
# `#!/usr/bin/env -S npx tsx` shebang would fetch a second one instead of
# running the version the repo pins, so the lookup stays where the rest of the
# harness keeps it — `node_modules/.bin/tsx`, under the repo root.
#
# Arguments are forwarded verbatim, and nothing here changes directory: the
# programs take their file paths relative to where they were invoked.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# The bin the reader typed, and the program under `scripts/` to run as it.
BENCH_LAUNCH_BIN="$1"
BENCH_LAUNCH_PROGRAM="$2"
shift 2

# The same scrub as `tracerbench.sh`, `profiler.sh` and `branchstat.sh`, for the
# same reason: GIT_DIR and friends win over `cwd`, so under a git hook the
# `--show-toplevel` below would report the hook's repository rather than the one
# the caller stands in — and this harness would run the wrong repo's `tsx` over
# the wrong repo's tree. It fails silently, because a bench of the wrong repo
# looks exactly like a bench. It also reaches the programs themselves, which
# resolve the tree they grep from their own cwd the same way.
#
# This class of bug has already recurred four times in this codebase. It lives
# here once now, so the fifth fix is one edit rather than three and a chance to
# miss one.
# shellcheck disable=SC2046  # intentional word-splitting of the var-name list
unset $(git rev-parse --local-env-vars)

# `BASH_SOURCE` through `realpath`: a bin entry can be installed as a symlink in
# `node_modules/.bin` — npm does exactly that — and an unresolved `dirname`
# lands there, where the programs do not exist. pnpm resolves it differently
# again, through a symlinked package directory into its content-addressed store.
# `realpath` is what makes both land on the real `scripts/`.
SCRIPT_DIR="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"
ROOT_DIR="$(git rev-parse --show-toplevel)"

# The name to print in the program's own usage message — the one the reader
# just typed, rather than the `tsx <path>` spelling it would otherwise guess at.
# Written down by each door rather than derived from `$0`: the file is named for
# its place in the tree, the bin is named for the command line, only the second
# is retypeable, and pnpm's shim does not carry it (see the header). A bench
# running a `.ts` directly sets nothing, and the program keeps its `tsx` form.
export BENCH_INVOKED_AS="$BENCH_LAUNCH_BIN"

exec "$ROOT_DIR/node_modules/.bin/tsx" \
  "$SCRIPT_DIR/$BENCH_LAUNCH_PROGRAM" "$@"
