import { afterEach, describe, expect, it, vi } from "vitest";

import { profilerConfig, tracerbenchConfig } from "./bench.playwright.mjs";

/**
 * The two config builders, read the way Playwright reads them.
 *
 * What is worth asserting is the contract the shell scripts and the consumer
 * meet on: the variables `tracerbench.sh` and `profiler.sh` export have to
 * reach the right field, and a repo that runs a bench by hand — no script, no
 * variables — has to get a working config anyway. Everything else in the
 * returned object is a constant, and pinning constants here would only restate
 * the module.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The `outputFile` of the `json` reporter, wherever it sits in the list. */
function jsonReportPath(config: { reporter?: unknown }): string | undefined {
  const entries = config.reporter as Array<[string, { outputFile?: string }?]>;
  return entries.find(([name]) => name === "json")?.[1]?.outputFile;
}

describe("tracerbenchConfig", () => {
  it("serves the build the bench built, on the port the bench chose", () => {
    // What `tracerbench.sh` exports for the experiment side.
    vi.stubEnv("TB_PORT", "4201");
    vi.stubEnv("TB_DIST", "dist-experiment");

    const config = tracerbenchConfig({
      command: ({ previewArgs }) => `pnpm exec vite preview ${previewArgs}`,
    });

    expect(config.webServer).toMatchObject({
      command:
        "pnpm exec vite preview --outDir dist-experiment --port 4201 --strictPort",
      url: "http://localhost:4201",
      // Each side must get its own server, or one branch gets benched twice.
      reuseExistingServer: false,
    });
    expect(config.use?.baseURL).toBe("http://localhost:4201");
  });

  it("serves the app's own build when no side was named", () => {
    const config = tracerbenchConfig({
      command: ({ port, dist, previewArgs }) => {
        expect(port).toBe(4200);
        expect(dist).toBeUndefined();
        return `vite preview ${previewArgs}`;
      },
    });

    // No `--outDir`: vite falls back to whatever the app builds to.
    expect(config.webServer).toMatchObject({
      command: "vite preview --port 4200 --strictPort",
      url: "http://localhost:4200",
    });
  });

  it("writes its artefacts where the bench will look for them", () => {
    vi.stubEnv("TB_OUTPUT_DIR", "tracerbench-results/control/traces");
    vi.stubEnv(
      "PLAYWRIGHT_JSON_OUTPUT_FILE",
      "tracerbench-results/control/report.json",
    );

    const config = tracerbenchConfig({ command: () => "vite preview" });

    expect(config.outputDir).toBe("tracerbench-results/control/traces");
    expect(jsonReportPath(config)).toBe(
      "tracerbench-results/control/report.json",
    );
  });

  it("falls back to the single-run paths when nothing is exported", () => {
    const config = tracerbenchConfig({ command: () => "vite preview" });

    expect(config.outputDir).toBe("tracerbench-results/traces");
    expect(jsonReportPath(config)).toBe("tracerbench-results/report.json");
  });

  it("gives the caller the per-test budget and keeps the server boot separate", () => {
    const config = tracerbenchConfig({
      command: () => "vite preview",
      timeout: 300_000,
    });

    expect(config.timeout).toBe(300_000);
    expect(config.webServer).toMatchObject({ timeout: 120_000 });
  });

  it("lets an unusual server story override the derived one", () => {
    const config = tracerbenchConfig({
      command: () => "vite preview",
      webServer: { timeout: 240_000, stdout: "pipe" },
    });

    expect(config.webServer).toMatchObject({
      command: "vite preview",
      url: "http://localhost:4200",
      timeout: 240_000,
      stdout: "pipe",
    });
  });
});

describe("profilerConfig", () => {
  it("starts the dev server on the port the bench chose", () => {
    vi.stubEnv("PROFILER_PORT", "4301");

    const config = profilerConfig({
      command: ({ port }) => `VITE_SERVER_PORT=${port} pnpm run dev`,
    });

    expect(config.webServer).toMatchObject({
      command: "VITE_SERVER_PORT=4301 pnpm run dev",
      url: "http://localhost:4301",
    });
    expect(config.use?.baseURL).toBe("http://localhost:4301");
  });

  it("defaults to 4300 when the bench is not driving", () => {
    const config = profilerConfig({ command: ({ port }) => `serve ${port}` });

    expect(config.webServer).toMatchObject({ command: "serve 4300" });
  });

  it("names the packaged render-cause recorder as its global setup", () => {
    // A path would not survive the copy into the control worktree; the
    // specifier resolves through whatever `node_modules` that worktree got.
    expect(profilerConfig({ command: () => "dev" }).globalSetup).toBe(
      "@abernier/skills/profiler-scan",
    );
  });

  it("gives the caller the per-test budget", () => {
    const config = profilerConfig({ command: () => "dev", timeout: 600_000 });

    expect(config.timeout).toBe(600_000);
  });

  it("honours a JSON report path, and has one of its own otherwise", () => {
    expect(jsonReportPath(profilerConfig({ command: () => "dev" }))).toBe(
      "profiler-results/playwright-report.json",
    );

    vi.stubEnv("PLAYWRIGHT_JSON_OUTPUT_FILE", "elsewhere/report.json");
    expect(jsonReportPath(profilerConfig({ command: () => "dev" }))).toBe(
      "elsewhere/report.json",
    );
  });
});
