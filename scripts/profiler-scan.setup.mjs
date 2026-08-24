import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Playwright `globalSetup` — bundles the bippy-based render-cause recorder
 * into a single IIFE so the spec can ship it to the page via `addInitScript`.
 *
 * Point a config at it by name, and let Node's resolution find it:
 *
 * ```ts
 * export default defineConfig({
 *   globalSetup: "@abernier/skills/profiler-scan",
 * });
 * ```
 *
 * Why bundle at run time rather than ship a pre-built file:
 * - The bundle inlines the `bippy` from the measured repo's own
 *   `node_modules`, so it stays in sync with that repo's package.json on every
 *   run — no chance of a stale artefact drifting from the installed lib.
 * - The output goes under `profiler-results/`, which is gitignored alongside
 *   the rest of the run artefacts.
 *
 * The bundle is identical for both the experiment and the control runs (the
 * control worktree never imports bippy itself — it just receives the IIFE), so
 * any difference observed in the recorded data reflects a real React-side
 * difference, not a tooling drift.
 *
 * Shipped as `.mjs` on purpose. Node strips types in first-party files only, so
 * a `.ts` file under `node_modules` throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
 * the moment Playwright loads it, and Playwright does not transform
 * `node_modules` either. The types live next door in `profiler-scan.setup.d.mts`.
 * `profiler-scan.injected.ts` beside it stays TypeScript: nothing imports it,
 * esbuild only ever reads it as an entry point and does its own transpilation.
 */

/** The recorder source, resolved from this file wherever the package landed. */
const SOURCE_PATH = fileURLToPath(
  new URL("./profiler-scan.injected.ts", import.meta.url),
);

/**
 * Where the spec expects to find the recorder IIFE.
 *
 * Relative to `process.cwd()`, which is the repo being measured: `profiler.sh`
 * runs each side from that side's own root, and a standalone `pnpm run
 * test:profiler` runs from the package root. Not relative to this file — it
 * lives under `node_modules`, which is nobody's output directory.
 *
 * `PROFILER_SCAN_BUNDLE` overrides that default so the plugin's `profiler.sh`
 * can pre-build the bundle once on the experiment side (where `bippy` and
 * `esbuild` are installed) and point both the experiment and the control runs
 * at the same file. The control branch never needs `bippy`/`esbuild` in its own
 * dependency tree — it just consumes the pre-built IIFE.
 */
export const SCAN_BUNDLE_PATH =
  process.env.PROFILER_SCAN_BUNDLE ??
  path.resolve(process.cwd(), "profiler-results", "scan-bundle.js");

/**
 * Build the bundle on demand when running the spec standalone (`pnpm run
 * test:profiler` without `profiler.sh`). Skipped when:
 *
 *  - the bundle already exists AND is newer than the recorder source. This
 *    avoids serving stale code when the recorder changed between runs.
 *  - the env var `PROFILER_SCAN_BUNDLE` points at an existing file (CI path:
 *    `profiler.sh` pre-builds, both runs reuse the same bundle, and the control
 *    worktree lacks `esbuild`/`bippy` so we must not try to rebuild there). We
 *    trust the caller in that case.
 *
 * `esbuild` and `bippy` are both resolved from the measured repo, never from
 * this package — see `measuredRequire` and `nodePaths` below. Resolving them
 * lazily, inside the function, is also what keeps the control side from ever
 * reaching for either.
 */
export default async function globalSetup() {
  if (fs.existsSync(SCAN_BUNDLE_PATH)) {
    // When the env var override is set we always trust the caller's file —
    // they're responsible for keeping it fresh (profiler.sh always rebuilds).
    if (process.env.PROFILER_SCAN_BUNDLE) {
      console.log(`📦 scan bundle: ${SCAN_BUNDLE_PATH} (caller-managed)`);
      return;
    }
    const bundleStat = fs.statSync(SCAN_BUNDLE_PATH);
    const sourceStat = fs.statSync(SOURCE_PATH);
    if (bundleStat.mtimeMs >= sourceStat.mtimeMs) {
      console.log(`📦 scan bundle: ${SCAN_BUNDLE_PATH} (cached)`);
      return;
    }
    // Source is newer than the cached bundle — fall through to rebuild.
    console.log(`📦 scan bundle stale (source newer than bundle) — rebuilding`);
  }
  console.log(`📦 building scan bundle → ${SCAN_BUNDLE_PATH}`);

  // `esbuild` is the measured repo's, not this package's. This package declares
  // no runtime dependencies, and under pnpm its real path is a store directory
  // whose siblings are its own deps — resolving from there would miss the very
  // `esbuild` the repo installed to run this.
  const measuredRequire = createRequire(
    path.join(process.cwd(), "package.json"),
  );
  const { build } = measuredRequire("esbuild");

  await build({
    entryPoints: [SOURCE_PATH],
    // Same reason, one level down: the entry point is a file inside this
    // package, so esbuild walks up from *there* looking for `bippy` and under
    // pnpm lands in the store instead of the measured repo. `nodePaths` is
    // esbuild's NODE_PATH — an extra place to look, searched after the walk.
    nodePaths: [path.join(process.cwd(), "node_modules")],
    bundle: true,
    format: "iife",
    target: "es2020",
    platform: "browser",
    outfile: SCAN_BUNDLE_PATH,
    // Keep names so component display names round-trip cleanly. esbuild's
    // default minify-identifiers strips them, which would defeat the whole
    // point of the recorder.
    keepNames: true,
    sourcemap: false,
    logLevel: "warning",
  });
}
