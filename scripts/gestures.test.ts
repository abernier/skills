import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { smoothDrag, smoothMove, wheel, wheelBurst } from "./gestures.mjs";

/**
 * The gesture primitives, driven against a real browser.
 *
 * They are thin on purpose, and a stub `Page` recording `mouse.move` calls
 * would assert the implementation back at itself — it would not catch the two
 * things that actually go wrong here: a `WheelEvent` that reaches no listener
 * because `elementFromPoint` returned nothing, and a wheel that silently stops
 * scrolling the page because it became synthetic. Both are browser facts, so
 * the suite launches Chromium and reads what the page recorded.
 *
 * No dev server and no fixtures: one `setContent` page that logs its events.
 *
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
    `⚠️  skipping the gesture suite: Chromium would not launch ` +
      `(${err instanceof Error ? err.message.split("\n")[0] : err}).\n` +
      `   Run \`pnpm exec playwright install chromium\`.`,
  );
}

/** A page that records what it was sent, and a box a drag can move. */
const PAGE = `
<style>
  html, body { margin: 0; }
  #tall { height: 5000px; }
  #box { position: absolute; left: 100px; top: 100px; width: 80px; height: 80px; background: #c00; }
</style>
<div id="tall"></div>
<div id="box"></div>
<script>
  window.log = { moves: [], wheels: [] };
  addEventListener("mousemove", (e) => log.moves.push([e.clientX, e.clientY]));
  addEventListener(
    "wheel",
    (e) => log.wheels.push({
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      trusted: e.isTrusted,
    }),
    { passive: true },
  );

  const box = document.getElementById("box");
  let grab = null;
  box.addEventListener("mousedown", (e) => {
    grab = { x: e.clientX, y: e.clientY, left: box.offsetLeft, top: box.offsetTop };
  });
  addEventListener("mousemove", (e) => {
    if (!grab) return;
    box.style.left = grab.left + e.clientX - grab.x + "px";
    box.style.top = grab.top + e.clientY - grab.y + "px";
  });
  addEventListener("mouseup", () => { grab = null; });
</script>
`;

type Wheel = {
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  trusted: boolean;
};

const moves = (page: Page) =>
  page.evaluate(() => (window as never as { log: { moves: [number, number][] } }).log.moves);

const wheels = (page: Page) =>
  page.evaluate(() => (window as never as { log: { wheels: Wheel[] } }).log.wheels);

const boxAt = (page: Page) =>
  page.evaluate(() => {
    const box = document.getElementById("box")!;
    return [box.offsetLeft, box.offsetTop];
  });

afterAll(async () => {
  await browser?.close();
});

describe.skipIf(!browser)("gesture primitives", () => {
  let page: Page;

  beforeEach(async () => {
    page = await browser!.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(PAGE);
    return () => page.close();
  });

  it("moves the pointer one event at a time, endpoints included", async () => {
    await smoothMove(page, 10, 10, 210, 110, { steps: 4, stepDelay: 0 });

    expect(await moves(page)).toEqual([
      [10, 10],
      [60, 35],
      [110, 60],
      [160, 85],
      [210, 110],
    ]);
  });

  it("drags an element the whole distance, button held", async () => {
    await smoothDrag(page, 140, 140, 240, 200, { steps: 5, stepDelay: 0 });

    expect(await boxAt(page)).toEqual([200, 160]);
  });

  it("leaves the element alone when the button is never pressed", async () => {
    await smoothMove(page, 140, 140, 240, 200, { steps: 5, stepDelay: 0 });

    expect(await boxAt(page)).toEqual([100, 100]);
  });

  it("carries modifiers a trusted wheel would drop", async () => {
    await wheel(page, 400, 300, { deltaY: -120, ctrlKey: true });

    expect(await wheels(page)).toEqual([
      { deltaX: 0, deltaY: -120, ctrlKey: true, shiftKey: false, trusted: false },
    ]);
  });

  it("stays on the trusted wheel — and so still scrolls — with no modifier", async () => {
    await wheel(page, 400, 300, { deltaY: 200 });

    const [only] = await wheels(page);
    expect(only.trusted).toBe(true);
    expect(only.ctrlKey).toBe(false);
    expect(only.deltaY).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  it("splits a burst's total across its ticks", async () => {
    await wheelBurst(page, 400, 300, {
      deltaY: -400,
      ctrlKey: true,
      ticks: 4,
      tickDelay: 0,
    });

    const fired = await wheels(page);
    expect(fired).toHaveLength(4);
    expect(fired.every((w) => w.ctrlKey && w.deltaY === -100)).toBe(true);
  });

  it("puts the pointer on the point before the first tick", async () => {
    await wheelBurst(page, 320, 240, { deltaY: 60, ticks: 2, tickDelay: 0 });

    expect(await moves(page)).toEqual([[320, 240]]);

    const fired = await wheels(page);
    expect(fired).toHaveLength(2);
    expect(fired.every((w) => w.trusted && !w.ctrlKey)).toBe(true);
  });
});
