#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# `profiler-compare.ts` as a command — the `profiler-compare` bin entry.
#
# The bin cannot point at the `.ts` file: it needs a TypeScript loader, and the
# one this harness uses is deliberately the measured repo's own `tsx`. A
# `#!/usr/bin/env -S npx tsx` shebang would fetch a second one instead of
# running the version the repo pins, so the lookup stays where the rest of the
# harness keeps it — `node_modules/.bin/tsx`, under the repo root.
#
# Arguments are forwarded verbatim, and nothing here changes directory: the
# comparer takes report paths relative to where it was invoked.
# ──────────────────────────────────────────────────────────────────────────────

# The same scrub as `tracerbench.sh`, for the same reason: GIT_DIR and friends
# win over `cwd`, so under a git hook the `--show-toplevel` below would report
# the cwd rather than the repo whose `tsx` this runs. It also reaches the
# comparer, which resolves the tree it greps from its own cwd the same way.
# shellcheck disable=SC2046  # intentional word-splitting of the var-name list
unset $(git rev-parse --local-env-vars)

# `BASH_SOURCE` through `realpath`: the bin entry installs this script as a
# symlink in `node_modules/.bin`, and an unresolved `dirname` lands there —
# where the comparer it runs does not exist.
SCRIPT_DIR="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"
ROOT_DIR="$(git rev-parse --show-toplevel)"

exec "$ROOT_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/profiler-compare.ts" "$@"
