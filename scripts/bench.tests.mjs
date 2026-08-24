/**
 * The vitest plugin that runs this package's compare suite in a consumer's own
 * `vitest run`.
 *
 * `bench.tests.d.mts` beside it is generated from the JSDoc below —
 * `pnpm run types:emit`. Edit the JSDoc, not the declaration.
 */

/**
 * @import { Plugin } from "vitest/config"
 */

import { fileURLToPath } from "node:url";

// Resolved from this file rather than written down as
// `node_modules/@abernier/skills/scripts/…`: pnpm, npm and a workspace each put
// the package somewhere different, and `import.meta.url` is already wherever
// that turned out to be.
const BENCH_TEST_FILE = fileURLToPath(
  new URL("./profiler.compare.test.ts", import.meta.url),
);

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
export function benchTests() {
  // A project, not an entry appended to `test.include`. Two reasons, both of
  // them failures seen before this existed:
  //
  //   - vitest's default `exclude` covers `node_modules`, so an `include`
  //     naming the file is silently collected as nothing. Narrowing that
  //     `exclude` to let one file through un-ignores the whole tree — every
  //     `*.test.ts` any dependency ships gets collected along with it, and the
  //     crawl gets an order of magnitude slower. There is no ignore pattern
  //     that subtracts a single path.
  //   - `include` and `exclude` are the consumer's. Rewriting either is how a
  //     plugin drops tests nobody asked it to touch.
  //
  // A project carries its own root, `include` and `exclude`, so it reaches this
  // one file and touches nothing else. When the config declares no projects,
  // the root config becomes the first one — `{ extends: true }` is vitest's
  // spelling for "everything this config already said" — and the consumer's
  // suite keeps running exactly as it did.
  return {
    name: "@abernier/skills:bench-tests",

    config(config) {
      const test = (config.test ??= {});
      test.projects = [
        ...(test.projects ?? [{ extends: true }]),
        {
          test: {
            name: "bench",
            include: [BENCH_TEST_FILE],
            // Nothing to exclude: the include names one absolute path, and
            // vitest's default would drop it for living under `node_modules`.
            exclude: [],
          },
        },
      ];
    },
  };
}
