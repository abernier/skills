/**
 * Absolute path of the recorder IIFE the spec injects.
 *
 * ```ts
 * import { SCAN_BUNDLE_PATH } from "@abernier/skills/profiler-scan";
 *
 * await page.addInitScript({ path: SCAN_BUNDLE_PATH });
 * ```
 *
 * `$PROFILER_SCAN_BUNDLE` when set — that is how `profiler.sh` hands the
 * experiment and the control runs one byte-identical bundle. Otherwise
 * `profiler-results/scan-bundle.js` under the current working directory.
 */
export declare const SCAN_BUNDLE_PATH: string;

/**
 * Playwright `globalSetup`: builds the recorder into `SCAN_BUNDLE_PATH`.
 *
 * ```ts
 * export default defineConfig({
 *   globalSetup: "@abernier/skills/profiler-scan",
 * });
 * ```
 *
 * Reuses the file already there when `$PROFILER_SCAN_BUNDLE` names it, or when
 * it is newer than the recorder source. `esbuild` and `bippy` are resolved from
 * the repo being measured, so both have to be devDependencies of that repo.
 */
export default function globalSetup(): Promise<void>;
