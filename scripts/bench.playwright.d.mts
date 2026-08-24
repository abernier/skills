import type { PlaywrightTestConfig } from "@playwright/test";

/** What `tracerbenchConfig`'s `command` is handed. */
export interface TracerbenchServer {
  /** The resolved `TB_PORT`. */
  port: number;
  /** `http://localhost:<port>`, the same URL the tests use. */
  baseURL: string;
  /** The resolved `TB_DIST`, or `undefined` when the app should serve its own default build. */
  dist: string | undefined;
  /**
   * The `vite preview` flags for this run — `--outDir` (only when `TB_DIST` is
   * set), `--port` and `--strictPort`, ready to append to whatever runs vite in
   * your repo. A non-vite server ignores it and reads `port` and `dist`
   * directly.
   */
  previewArgs: string;
}

/** Options for the TracerBench config. */
export interface TracerbenchOptions {
  /** How to serve the production build. Called with the port already resolved. */
  command: (server: TracerbenchServer) => string;
  /** Per-test budget in ms. Default `120_000`. */
  timeout?: number;
  /**
   * Shallow-merged over the derived `webServer`, for a server story the two
   * knobs above do not cover — extra `env`, a different boot `timeout`,
   * `stdout`.
   */
  webServer?: Partial<NonNullable<PlaywrightTestConfig["webServer"]>>;
}

/** What `profilerConfig`'s `command` is handed. */
export interface ProfilerServer {
  /** The resolved `PROFILER_PORT`. */
  port: number;
  /** `http://localhost:<port>`, the same URL the tests use. */
  baseURL: string;
}

/** Options for the profiler config. */
export interface ProfilerOptions {
  /** How to start the **dev** server. Called with the port already resolved. */
  command: (server: ProfilerServer) => string;
  /** Per-test budget in ms. Default `120_000`. */
  timeout?: number;
  /**
   * Shallow-merged over the derived `webServer`, for a server story the two
   * knobs above do not cover — extra `env`, a different boot `timeout`,
   * `stdout`.
   */
  webServer?: Partial<NonNullable<PlaywrightTestConfig["webServer"]>>;
}

/**
 * The Playwright config the `tracerbench` bench runs your
 * `e2e/tracerbench.spec.ts` under.
 *
 * ```ts
 * // playwright.tracerbench.config.ts
 * import { tracerbenchConfig } from "@abernier/skills/playwright";
 *
 * export default tracerbenchConfig({
 *   command: ({ previewArgs }) => `pnpm --filter=app exec vite preview ${previewArgs}`,
 *   timeout: 300_000,
 * });
 * ```
 *
 * Reads `TB_PORT`, `TB_DIST`, `TB_OUTPUT_DIR` and
 * `PLAYWRIGHT_JSON_OUTPUT_FILE`. The server is never reused: each side of a
 * comparison must get its own, or one branch gets benched twice.
 */
export declare function tracerbenchConfig(
  options: TracerbenchOptions,
): PlaywrightTestConfig;

/**
 * The Playwright config the `profiler` bench runs your `e2e/profiler.spec.ts`
 * under.
 *
 * ```ts
 * // playwright.profiler.config.ts
 * import { profilerConfig } from "@abernier/skills/playwright";
 *
 * export default profilerConfig({
 *   command: ({ port }) => `VITE_SERVER_PORT=${port} pnpm run dev`,
 *   timeout: 600_000,
 * });
 * ```
 *
 * Reads `PROFILER_PORT` and `PLAYWRIGHT_JSON_OUTPUT_FILE`, and names
 * `@abernier/skills/profiler-scan` as its `globalSetup`.
 */
export declare function profilerConfig(
  options: ProfilerOptions,
): PlaywrightTestConfig;
