// The commit log is written last, so a step that never happened leaves no file
// — which is exactly how a leg ends up with no report.
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "@playwright/test";
import { SCAN_BUNDLE_PATH } from "@abernier/skills/profiler-scan";
import type { CommitRecord, PerfIdStats } from "@abernier/skills/bench-types";

declare global {
  interface Window {
    __perfStats?: { reset(): void; snapshot(): Record<string, PerfIdStats> };
    __renderScan__?: { reset(): void; snapshot(): CommitRecord[] };
  }
}

const COMMITS =
  process.env.PROFILER_COMMITS ??
  path.resolve(process.cwd(), "profiler-results", "commits.json");

test("mount and tick", async ({ page }) => {
  // Before the first navigation: the recorder patches React's devtools hook,
  // and a patch that lands after React boots records nothing.
  await page.addInitScript({ path: SCAN_BUNDLE_PATH });

  const steps: unknown[] = [];

  const record = async (step: string, run: () => Promise<void>) => {
    const startedAt = Date.now();
    await run();
    const { byId, commits } = await page.evaluate(() => ({
      byId: window.__perfStats?.snapshot() ?? {},
      commits: window.__renderScan__?.snapshot() ?? [],
    }));
    steps.push({
      step,
      durationMs: Date.now() - startedAt,
      totalCommits: Object.values(byId).reduce(
        (n, s) => n + s.mount.count + s.update.count,
        0,
      ),
      byId,
      commits,
    });
    await page.evaluate(() => {
      window.__perfStats?.reset();
      window.__renderScan__?.reset();
    });
  };

  await record("mount", async () => {
    await page.goto("/");
    await expect(page.getByTestId("app")).toBeVisible();
  });

  await record("tick", async () => {
    for (let i = 1; i <= 5; i++) {
      await page.getByTestId("tick").click();
      await expect(page.getByTestId("app")).toHaveAttribute(
        "data-tick",
        String(i),
      );
    }
  });

  fs.mkdirSync(path.dirname(COMMITS), { recursive: true });
  fs.writeFileSync(
    COMMITS,
    JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      url: page.url(),
      steps,
    }),
  );
});
