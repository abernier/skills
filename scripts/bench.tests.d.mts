/**
 * The vitest plugin that runs this package's compare suite in a consumer's own
 * `vitest run`.
 *
 * `bench.tests.d.mts` beside it is generated from the JSDoc below —
 * `pnpm run types:emit`. Edit the JSDoc, not the declaration.
 */
import type { Plugin } from "vitest/config";
/**
 * Run the bench harness's compare suite as part of the repo's own `vitest run`.
 *
 * ```ts
 * // vitest.config.ts
 * import { defineConfig } from "vitest/config";
 * import { benchTests } from "@abernier/skills/bench-tests";
 *
 * export default defineConfig({ plugins: [benchTests()] });
 * ```
 *
 * The suite's last block is the one only a consumer can run: it derives its
 * subject from `sourceRoots` at run time, and goes red when the source tree
 * moved and `bench.json` did not.
 *
 * It adds a `bench` project holding that one file, so it needs no `include` and
 * rewrites no `exclude` — whatever the config already collects, it keeps
 * collecting.
 *
 * @returns {Plugin}
 */
export declare function benchTests(): Plugin;
