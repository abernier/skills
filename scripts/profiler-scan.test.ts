import { chromium, type Browser } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SCAN_BUNDLE_PATH as ScanBundlePath } from "./profiler-scan.setup.mjs";

/**
 * The Playwright `globalSetup` this package ships, and the recorder it bundles.
 *
 * What actually goes wrong here is packaging, not logic: an `esbuild` or a
 * `bippy` resolved from the wrong tree, a bundle written next to the package
 * instead of next to the repo being measured, an IIFE that never installs its
 * API. So the suite runs the real thing — esbuild builds the real recorder from
 * the real `bippy` — and then asks a real page what the bundle did to it.
 *
 * `SCAN_BUNDLE_PATH` is read from the environment at import time, which is what
 * lets `profiler.sh` hand both runs one bundle. Each case therefore imports the
 * module fresh, under the environment it wants to test.
 */
type Setup = {
  SCAN_BUNDLE_PATH: typeof ScanBundlePath;
  default: () => Promise<void>;
};

const importSetup = async (bundle?: string): Promise<Setup> => {
  vi.resetModules();
  if (bundle === undefined) delete process.env.PROFILER_SCAN_BUNDLE;
  else process.env.PROFILER_SCAN_BUNDLE = bundle;
  return (await import("./profiler-scan.setup.mjs")) as unknown as Setup;
};

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "profiler-scan-"));
  return () => fs.rmSync(tmp, { recursive: true, force: true });
});

afterAll(() => {
  delete process.env.PROFILER_SCAN_BUNDLE;
});

describe("SCAN_BUNDLE_PATH", () => {
  it("is the caller's file when $PROFILER_SCAN_BUNDLE names one", async () => {
    const { SCAN_BUNDLE_PATH } = await importSetup("/somewhere/else/scan.js");

    expect(SCAN_BUNDLE_PATH).toBe("/somewhere/else/scan.js");
  });

  it("otherwise lands under the measured repo, not under this package", async () => {
    const { SCAN_BUNDLE_PATH } = await importSetup();

    expect(SCAN_BUNDLE_PATH).toBe(
      path.resolve(process.cwd(), "profiler-results", "scan-bundle.js"),
    );
    expect(SCAN_BUNDLE_PATH).not.toContain("node_modules");
  });
});

describe("globalSetup", () => {
  it("builds a self-contained IIFE with bippy inlined", async () => {
    const outfile = path.join(tmp, "scan-bundle.js");
    const { default: globalSetup } = await importSetup(outfile);

    await globalSetup();

    const bundle = fs.readFileSync(outfile, "utf8");
    // Inlined, not left as an import: the control worktree runs this file with
    // no `bippy` in its tree at all.
    expect(bundle).not.toMatch(/\b(require|import)\s*\(?\s*["']bippy["']/);
    expect(bundle).toContain("__REACT_DEVTOOLS_GLOBAL_HOOK__");
    // `keepNames`, or every component the recorder names comes back mangled.
    // esbuild spells it as a `__name` call restoring `Function.name`.
    expect(bundle).toContain('__name(classify, "classify")');
  });

  it("leaves a caller-managed bundle exactly as it found it", async () => {
    const outfile = path.join(tmp, "scan-bundle.js");
    fs.writeFileSync(outfile, "/* the caller's own recorder */");
    const { default: globalSetup } = await importSetup(outfile);

    await globalSetup();

    expect(fs.readFileSync(outfile, "utf8")).toBe(
      "/* the caller's own recorder */",
    );
  });
});

/**
 * Chromium is a separate download from the npm install, so a checkout that has
 * not run `pnpm exec playwright install chromium` skips this block and says so
 * — the same deal `branchstat` strikes with `cloc`. CI installs it, so CI never
 * takes that path.
 */
let browser: Browser | undefined;
try {
  browser = await chromium.launch();
} catch (err) {
  console.warn(
    `⚠️  skipping the injected-recorder suite: Chromium would not launch ` +
      `(${err instanceof Error ? err.message.split("\n")[0] : err}).\n` +
      `   Run \`pnpm exec playwright install chromium\`.`,
  );
}

afterAll(async () => {
  await browser?.close();
});

describe.skipIf(!browser)("the bundle, in a page", () => {
  it("installs the recorder API before the page's own scripts run", async () => {
    const outfile = path.join(tmp, "scan-bundle.js");
    const { default: globalSetup, SCAN_BUNDLE_PATH } =
      await importSetup(outfile);
    await globalSetup();

    const page = await browser!.newPage();
    try {
      // A served page and a real navigation, not `setContent`: `addInitScript`
      // runs on navigation, and `setContent` is a `document.write` into the
      // page already open — the init script would never fire.
      await page.route("http://scan.test/", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<script>window.seenAtLoad = typeof window.__renderScan__;</script>`,
        }),
      );
      // From here on, exactly what the profiler spec does with it.
      await page.addInitScript({ path: SCAN_BUNDLE_PATH });
      await page.goto("http://scan.test/");

      expect(await page.evaluate(() => window.seenAtLoad)).toBe("object");
      expect(
        await page.evaluate(() => [
          typeof window.__renderScan__?.reset,
          typeof window.__renderScan__?.snapshot,
        ]),
      ).toEqual(["function", "function"]);
      // No React on this page, so no commits — but the recorder answers.
      expect(
        await page.evaluate(() => window.__renderScan__?.snapshot()),
      ).toEqual([]);
    } finally {
      await page.close();
    }
  });
});

// `__renderScan__` is not declared here on purpose: the recorder declares it
// globally already, and asserting through *its* type is what catches the day
// the two disagree.
declare global {
  interface Window {
    seenAtLoad: string;
  }
}
