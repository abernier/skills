#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# `profiler.aggregate.ts` as a command — the `profiler-aggregate` bin entry.
#
# The bin cannot point at the `.ts` file: it needs a TypeScript loader, and the
# one this harness uses is deliberately the measured repo's own `tsx`. A
# `#!/usr/bin/env -S npx tsx` shebang would fetch a second one instead of
# running the version the repo pins, so the lookup stays where the rest of the
# harness keeps it — `node_modules/.bin/tsx`, under the repo root.
#
# Arguments are forwarded verbatim, and nothing here changes directory: the
# program takes its file paths relative to where it was invoked.
# ──────────────────────────────────────────────────────────────────────────────

# The same scrub as `tracerbench.sh`, for the same reason: GIT_DIR and friends
# win over `cwd`, so under a git hook the `--show-toplevel` below would report
# the cwd rather than the repo whose `tsx` this runs.
# shellcheck disable=SC2046  # intentional word-splitting of the var-name list
unset $(git rev-parse --local-env-vars)

# `BASH_SOURCE` through `realpath`: the bin entry installs this script as a
# symlink in `node_modules/.bin`, and an unresolved `dirname` lands there —
# where the program it runs does not exist.
SCRIPT_DIR="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"
ROOT_DIR="$(git rev-parse --show-toplevel)"

# The name to print in the program's own usage message — the one the reader
# just typed, rather than the `tsx <path>` spelling it would otherwise guess at.
# Written down rather than derived from `$0`: the file is named for its place in
# the tree, the bin is named for the command line, and only the second is
# retypeable. A bench running the `.ts` directly sets nothing, and the program
# keeps its `tsx` form.
export BENCH_INVOKED_AS="profiler-aggregate"

exec "$ROOT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/profiler.aggregate.ts" "$@"
