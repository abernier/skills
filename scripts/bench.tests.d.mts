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
 * It adds a `bench` project holding that one file, so it needs no `include` and
 * rewrites no `exclude` — whatever the config already collects, it keeps
 * collecting.
 */
export declare function benchTests(): Plugin;
