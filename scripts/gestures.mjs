/**
 * Human-like Playwright gestures, for the specs the bench harness runs.
 *
 * Deliberately dependency-free — pure Playwright, no app imports. A bench spec
 * is copied into a control worktree next to a checkout of another commit, and
 * an app import would drag that app's component tree into the Playwright
 * process.
 *
 * Shipped as `.mjs` on purpose. Node strips types in first-party files only, so
 * a `.ts` file under `node_modules` throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
 * the moment a spec imports it, and Playwright does not transform `node_modules`
 * either. The types live next door in `gestures.d.mts`.
 */

/**
 * Move the pointer along a straight line, one event at a time.
 *
 * `page.mouse.move(x, y, { steps })` fires its intermediate moves back to back,
 * which is not what a hand does and not what a `pointermove` handler is priced
 * against. The delay between steps is what makes a lap realistic.
 *
 * Fires `steps + 1` moves: the line's start and its end are both sent.
 *
 * @param {import("@playwright/test").Page} page
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {{ steps?: number, stepDelay?: number }} [opts]
 */
export async function smoothMove(
  page,
  fromX,
  fromY,
  toX,
  toY,
  { steps = 25, stepDelay = 12 } = {},
) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
    if (stepDelay > 0) await page.waitForTimeout(stepDelay);
  }
}

/**
 * `smoothMove`, with the button held down for the whole line.
 *
 * The pauses around the press and the release are part of the gesture: a
 * `pointerdown` handler that starts a drag on the next frame sees a real one.
 *
 * @param {import("@playwright/test").Page} page
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {{ steps?: number, stepDelay?: number }} [opts]
 */
export async function smoothDrag(page, fromX, fromY, toX, toY, opts) {
  await page.mouse.move(fromX, fromY);
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.waitForTimeout(30);
  await smoothMove(page, fromX, fromY, toX, toY, opts);
  await page.waitForTimeout(30);
  await page.mouse.up();
}

/**
 * One wheel event at a point, modifiers included.
 *
 * Two paths because `page.mouse.wheel` drops modifiers, and a pinch-zoom is
 * exactly a wheel with `ctrlKey`. Unmodified it stays on Playwright's own
 * wheel — a trusted event, which scrolls the page like a real notch; a
 * hand-dispatched one would silently stop doing that.
 *
 * `page.mouse.wheel` resolves before the page has seen anything — the event is
 * sent, then delivered a frame later — so that path waits one frame. Measured
 * on an empty page, reading the listener's log straight after the call finds it
 * empty every time, and finds the event after one `requestAnimationFrame` every
 * time. Both paths therefore mean the same thing when they resolve: the page
 * has had the event. A primitive that only sometimes has is a flaky assertion
 * in every spec that uses it.
 *
 * @param {import("@playwright/test").Page} page
 * @param {number} x
 * @param {number} y
 * @param {{ deltaX?: number, deltaY?: number, ctrlKey?: boolean, shiftKey?: boolean }} [opts]
 */
/**
 * One notch, at the point, without touching the pointer. Private: every public
 * entry point puts the pointer on the point first, once per gesture, and the
 * ticks of a burst must not each fire a `mousemove` an app would have to handle.
 */
async function notch(page, x, y, { deltaX, deltaY, ctrlKey, shiftKey }) {
  if (!ctrlKey && !shiftKey) {
    await page.mouse.wheel(deltaX, deltaY);
    // Playwright's wheel resolves once the event is sent, not once the page has
    // it. Wait a frame so this call means the same thing the dispatched path
    // does: the page has seen it, and the next line may assert on the effect.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
    );
    return;
  }
  await page.evaluate(
    ([x, y, deltaX, deltaY, ctrlKey, shiftKey]) => {
      const target = document.elementFromPoint(x, y) ?? document.body;
      target.dispatchEvent(
        new WheelEvent("wheel", {
          clientX: x,
          clientY: y,
          deltaX,
          deltaY,
          ctrlKey,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    /** @type {const} */ ([x, y, deltaX, deltaY, ctrlKey, shiftKey]),
  );
}

export async function wheel(
  page,
  x,
  y,
  { deltaX = 0, deltaY = 0, ctrlKey = false, shiftKey = false } = {},
) {
  // The pointer goes to the point on both paths. The dispatched one aims itself
  // through `elementFromPoint`, but a trusted wheel fires wherever the pointer
  // already sat — so without this, `x, y` would mean the point on one path and
  // nothing at all on the other, under one signature.
  await page.mouse.move(x, y);
  await notch(page, x, y, { deltaX, deltaY, ctrlKey, shiftKey });
}

export async function wheelBurst(
  page,
  x,
  y,
  { deltaX = 0, deltaY = 0, ticks = 8, tickDelay = 40, ...modifiers } = {},
) {
  await page.mouse.move(x, y);
  for (let i = 0; i < ticks; i++) {
    await notch(page, x, y, {
      ctrlKey: false,
      shiftKey: false,
      ...modifiers,
      deltaX: deltaX / ticks,
      deltaY: deltaY / ticks,
    });
    if (tickDelay > 0) await page.waitForTimeout(tickDelay);
  }
}

