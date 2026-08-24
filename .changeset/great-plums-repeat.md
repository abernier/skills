---
"@abernier/skills": minor
---

The profiler's render-cause recorder and the Playwright `globalSetup` that
bundles it now ship here, at `@abernier/skills/profiler-scan`.

Both files were already the plugin's in everything but location. `profiler.sh`
hardcoded both names, and one of its two `cp`s into the control worktree was
unconditional — a consumer that deleted either one broke the bench under `set
-euo pipefail`. The two repos running this harness carried them byte-identically:
the recorder to the byte, the setup down to a single word in a single comment.
A file every consumer must have, at a path the harness already knows, is not the
consumer's file.

They ship in different shapes, because they are loaded in different ways.
`profiler-scan.setup.mjs` is imported — Playwright loads it as `globalSetup`, and
a spec reads `SCAN_BUNDLE_PATH` off it — so it is `.mjs` with
`profiler-scan.setup.d.mts` beside it, the same reason `gestures.mjs` is: Node
strips types in first-party files only, and Playwright does not transform
`node_modules`. `profiler-scan.injected.ts` is never imported by anything;
esbuild reads it as an entry point and transpiles it itself, so it stays
TypeScript and keeps its types.

Both now resolve their dependencies from the repo being measured rather than
from this package — `esbuild` through a `require` rooted at that repo's
`package.json`, `bippy` through esbuild's `nodePaths` — because under pnpm this
package's real path is a store directory whose siblings are its own
dependencies. The bundle's default location moved for the same reason: it lands
under the measured repo's `profiler-results/`, never beside the package. And
`profiler.sh` no longer copies the setup into the control worktree: that worktree
resolves the package through the `node_modules` it is already given, exactly as
it does for `@abernier/skills/gestures`.

`$PROFILER_SCAN_BUNDLE` is unchanged and still the escape hatch. Pointed at a
file that already exists, `globalSetup` builds nothing and trusts it — which is
how `profiler` hands the experiment and the control one byte-identical recorder,
and how a repo that needs a recorder of its own swaps one in.

BREAKING: delete `e2e/profiler-scan.setup.ts` and `e2e/profiler-scan.injected.ts`,
point `globalSetup` at `"@abernier/skills/profiler-scan"` in
`playwright.profiler.config.ts`, and import `SCAN_BUNDLE_PATH` from there in your
spec. Keep `bippy` and `esbuild` as your own devDependencies — the bundle is
still built from your tree. No migration.
