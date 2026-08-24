// Near-empty on purpose, and the same scenario as the profiler's spec: mount,
// then click. Everything expensive is the app's doing — see `src/rows.ts`.
import { expect, test } from "@playwright/test";

test("mount and tick", async ({ page }) => {
  await test.step("mount", async () => {
    await page.goto("/");
    await expect(page.getByTestId("app")).toBeVisible();
  });

  await test.step("tick", async () => {
    for (let i = 1; i <= 5; i++) {
      await page.getByTestId("tick").click();
      await expect(page.getByTestId("app")).toHaveAttribute(
        "data-tick",
        String(i),
      );
    }
  });
});
