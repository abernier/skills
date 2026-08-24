/**
 * The Playwright configs the two benches run under.
 *
 * `tracerbench` and `profiler` drive your specs through `playwright test`, and
 * they talk to that run entirely through environment variables. Those variables
 * are this package's widest interface, and until this module existed every
 * consumer had to rediscover them and hand-write a config that read them back.
 * The two builders here are that config:
 *
 * ```ts
 * // playwright.tracerbench.config.ts
 * import { tracerbenchConfig } from "@abernier/skills/playwright";
 *
 * export default tracerbenchConfig({
 *   command: ({ previewArgs }) => `vite preview ${previewArgs}`,
 * });
 * ```
 *
 * ```ts
 * // playwright.profiler.config.ts
 * import { profilerConfig } from "@abernier/skills/playwright";
 *
 * export default profilerConfig({
 *   command: ({ port }) => `VITE_SERVER_PORT=${port} pnpm run dev`,
 * });
 * ```
 *
 * ### The eight variables
 *
 * Five are read here; the other three are read by the spec and by the scan
 * setup, and are listed so the whole contract sits in one place.
 *
 * | variable | default | read by | what it says |
 * | --- | --- | --- | --- |
 * | `TB_PORT` | `4200` | this module | Port `vite preview` binds and the tests hit. `tracerbench` gives control 4200 and experiment 4201, so a leftover server from the other side can never be silently reused. |
 * | `TB_DIST` | vite's own `outDir` | this module | The built bundle to serve, as the **last segment** of the dist path — `vite preview --outDir` resolves against the vite root, not the repo root. Unset means "whatever the app builds to". |
 * | `TB_OUTPUT_DIR` | `tracerbench-results/traces` | this module | Where Playwright writes traces and other per-test artefacts. |
 * | `TB_COUNTERS` | `tracerbench-results/counters.json` | your `e2e/tracerbench.spec.ts` | Where the spec writes the frame/counter samples the comparer reads. |
 * | `PLAYWRIGHT_JSON_OUTPUT_FILE` | per bench, see below | this module | Where the `json` reporter writes. `tracerbench-results/report.json` for TracerBench — the file `tracerbench-compare` diffs — and `profiler-results/playwright-report.json` for the profiler, which only ever reads it by hand. |
 * | `PROFILER_PORT` | `4300` | this module | Port the **dev** server binds. Control 4300, experiment 4301, same reason as `TB_PORT`. |
 * | `PROFILER_COMMITS` | `profiler-results/commits.json` | your `e2e/profiler.spec.ts` | Where the spec writes its raw commit log. `profiler-aggregate` folds that into the report `profiler-compare` diffs. |
 * | `PROFILER_SCAN_BUNDLE` | `profiler-results/scan-bundle.js` | `@abernier/skills/profiler-scan` | The pre-built render-cause recorder. When it names a file that already exists, the global setup builds nothing and trusts it — that is how both sides get one byte-identical recorder. |
 *
 * ### What you still have to pass
 *
 * `command`, always: only your repo knows how its dev server is spelled. It is
 * a function, not a string, because the port is derived here — from `TB_PORT`
 * or `PROFILER_PORT` — and you cannot write the command without it.
 *
 * `timeout` when a side takes longer than two minutes, which is the default.
 *
 * Everything else has an answer that is the same in every repo, and lives here.
 * For the rare rest there is `webServer`, shallow-merged over the one built for
 * you, and the return value is a plain config object you can spread and edit.
 *
 * Shipped as `.mjs` on purpose. Node strips types in first-party files only, so
 * a `.ts` file under `node_modules` throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
 * the moment a config imports it, and Playwright does not transform
 * `node_modules` either. `bench.playwright.d.mts` beside it is generated from
 * the JSDoc below — `pnpm run types:emit`. Edit the JSDoc, not the declaration.
 */

/**
 * @import { PlaywrightTestConfig } from "@playwright/test"
 */

import { defineConfig } from "@playwright/test";

/**
 * Read a port out of the environment, falling back when it is unset or unparseable.
 *
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function port(name, fallback) {
  return Number(process.env[name]) || fallback;
}

/**
 * The Playwright config the `tracerbench` bench runs your `e2e/tracerbench.spec.ts` under.
 *
 * Wall clock, against a prebuilt bundle served by `vite preview` — so the
 * numbers are production numbers. The profiler needs a dev build and therefore
 * cannot share this server.
 *
 * ```ts
 * export default tracerbenchConfig({
 *   command: ({ previewArgs }) => `pnpm --filter=app exec vite preview ${previewArgs}`,
 *   timeout: 300_000,
 * });
 * ```
 *
 * The server is never reused: each side of a comparison must get its own, or
 * one branch gets benched twice.
 *
 * @param {TracerbenchOptions} options
 * @returns {PlaywrightTestConfig}
 */
export function tracerbenchConfig(options) {
  const { command, timeout = 120_000, webServer } = options;
  const tbPort = port("TB_PORT", 4200);
  const baseURL = `http://localhost:${tbPort}`;
  const dist = process.env.TB_DIST;

  const previewArgs = [
    ...(dist ? ["--outDir", dist] : []),
    "--port",
    String(tbPort),
    "--strictPort",
  ].join(" ");

  return defineConfig({
    testDir: "./e2e",
    testMatch: /tracerbench\.spec/,
    workers: 1,
    timeout,
    use: { baseURL, trace: "on" },
    outputDir: process.env.TB_OUTPUT_DIR || "tracerbench-results/traces",
    webServer: {
      command: command({ port: tbPort, baseURL, dist, previewArgs }),
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      ...webServer,
    },
    reporter: [
      ["list"],
      [
        "json",
        {
          outputFile:
            process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ||
            "tracerbench-results/report.json",
        },
      ],
    ],
  });
}

/**
 * The Playwright config the `profiler` bench runs your `e2e/profiler.spec.ts` under.
 *
 * Render counts, against `vite dev` — **not** `vite preview`. `<React.Profiler>`
 * only emits `onRender` when paired with a development build of `react-dom`;
 * a production build strips the instrumentation and the accumulator stays
 * empty. Counts include StrictMode's dev-only double-mounts, which is fine for
 * regression detection: the diff is what matters.
 *
 * ```ts
 * export default profilerConfig({
 *   command: ({ port }) => `VITE_SERVER_PORT=${port} pnpm run dev`,
 *   timeout: 600_000,
 * });
 * ```
 *
 * `globalSetup` is `@abernier/skills/profiler-scan`, named rather than pathed:
 * the control worktree resolves it through the `node_modules` it is handed, so
 * nothing about the recorder is copied across branches.
 *
 * @param {ProfilerOptions} options
 * @returns {PlaywrightTestConfig}
 */
export function profilerConfig(options) {
  const { command, timeout = 120_000, webServer } = options;
  const profilerPort = port("PROFILER_PORT", 4300);
  const baseURL = `http://localhost:${profilerPort}`;

  return defineConfig({
    testDir: "./e2e",
    testMatch: /profiler\.spec/,
    workers: 1,
    fullyParallel: false,
    timeout,
    globalSetup: "@abernier/skills/profiler-scan",
    use: { baseURL, trace: "retain-on-failure" },
    outputDir: "profiler-results/traces",
    webServer: {
      command: command({ port: profilerPort, baseURL }),
      url: baseURL,
      // Local runs of the two sides sit on different ports and behind the
      // bench lock, so reuse can only ever pick up a server you started
      // yourself. CI has no such server and must not wait for one.
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      ...webServer,
    },
    reporter: [
      ["list"],
      [
        "json",
        {
          outputFile:
            process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ||
            "profiler-results/playwright-report.json",
        },
      ],
    ],
  });
}

// The vocabulary, last on purpose. A `@typedef` comment never attaches to the
// type alias `tsc` synthesizes from it — it is re-emitted where it sat in the
// source. Kept here, the generated declaration reads as the curated function
// docs first and these blocks as a footnote under the types they describe;
// kept at the top, they land in the middle of the file as a wall of tags.
// Line comments like this one are dropped from the emit, so this note stays put.

/**
 * What `tracerbenchConfig`'s `command` is handed.
 *
 * @typedef {object} TracerbenchServer
 * @property {number} port The resolved `TB_PORT`.
 * @property {string} baseURL `http://localhost:<port>`, the same URL the tests use.
 * @property {string | undefined} dist The resolved `TB_DIST`, or `undefined` when the app should serve its own default build.
 * @property {string} previewArgs The `vite preview` flags for this run — `--outDir` (only when `TB_DIST` is set), `--port` and `--strictPort`, ready to append to whatever runs vite in your repo. A non-vite server ignores it and reads `port` and `dist` directly.
 */

/**
 * Options for the TracerBench config.
 *
 * @typedef {object} TracerbenchOptions
 * @property {(server: TracerbenchServer) => string} command How to serve the production build. Called with the port already resolved.
 * @property {number} [timeout] Per-test budget in ms. Default `120_000`.
 * @property {Partial<NonNullable<PlaywrightTestConfig["webServer"]>>} [webServer] Shallow-merged over the derived `webServer`, for a server story the two knobs above do not cover — extra `env`, a different boot `timeout`, `stdout`.
 */

/**
 * What `profilerConfig`'s `command` is handed.
 *
 * @typedef {object} ProfilerServer
 * @property {number} port The resolved `PROFILER_PORT`.
 * @property {string} baseURL `http://localhost:<port>`, the same URL the tests use.
 */

/**
 * Options for the profiler config.
 *
 * @typedef {object} ProfilerOptions
 * @property {(server: ProfilerServer) => string} command How to start the **dev** server. Called with the port already resolved.
 * @property {number} [timeout] Per-test budget in ms. Default `120_000`.
 * @property {Partial<NonNullable<PlaywrightTestConfig["webServer"]>>} [webServer] Shallow-merged over the derived `webServer`, for a server story the two knobs above do not cover — extra `env`, a different boot `timeout`, `stdout`.
 */
