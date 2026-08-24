import { fileURLToPath } from "node:url";

/**
 * The compare suite this package ships.
 *
 * Resolved from this file rather than written down as
 * `node_modules/@abernier/skills/scripts/…`: pnpm, npm and a workspace each put
 * the package somewhere different, and `import.meta.url` is already wherever
 * that turned out to be.
 */
const BENCH_TEST_FILE = fileURLToPath(
  new URL("./profiler-compare.test.ts", import.meta.url),
);

/**
 * Run the bench harness's compare suite as part of the repo's own `vitest run`.
 *
 * Its last block is the one only a consumer can run: it derives its subject
 * from `sourceRoots` at run time, and goes red when the source tree moved and
 * `.claude/bench.json` did not.
 *
 * As a **project**, not as an entry appended to `test.include`. Two reasons,
 * both of them failures seen before this existed:
 *
 *   - vitest's default `exclude` covers `node_modules`, so an `include` naming
 *     the file is silently collected as nothing. Narrowing that `exclude` to
 *     let one file through un-ignores the whole tree — every `*.test.ts` any
 *     dependency ships gets collected along with it, and the crawl gets an
 *     order of magnitude slower. There is no ignore pattern that subtracts a
 *     single path.
 *   - `include` and `exclude` are the consumer's. Rewriting either is how a
 *     plugin drops tests nobody asked it to touch.
 *
 * A project carries its own root, `include` and `exclude`, so it reaches this
 * one file and touches nothing else. When the config declares no projects, the
 * root config becomes the first one — `{ extends: true }` is vitest's spelling
 * for "everything this config already said" — and the consumer's suite keeps
 * running exactly as it did.
 *
 * @returns {import("vitest/config").Plugin}
 */
export function benchTests() {
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
