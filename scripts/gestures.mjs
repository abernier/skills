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
 * either. `gestures.d.mts` beside it is generated from the JSDoc below —
 * `pnpm run types:emit`. Edit the JSDoc, not the declaration.
 */

/**
 * @import { Page } from "@playwright/test"
 */

/**
 * Move the pointer along a straight line, one event at a time.
 *
 * ```ts
 * await smoothMove(page, 100, 100, 400, 300, { steps: 40, stepDelay: 8 });
 * ```
 *
 * `page.mouse.move(x, y, { steps })` fires its intermediate moves back to back.
 * The delay between them is what makes a lap realistic.
 *
 * @param {Page} page
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {StrokeOptions} [opts]
 */
export async function smoothMove(page, fromX, fromY, toX, toY, opts = {}) {
  const { steps = 25, stepDelay = 12 } = opts;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
    if (stepDelay > 0) await page.waitForTimeout(stepDelay);
  }
}

/**
 * `smoothMove`, with the button held down for the whole line.
 *
 * @param {Page} page
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {StrokeOptions} [opts]
 */
export async function smoothDrag(page, fromX, fromY, toX, toY, opts = {}) {
  // The pauses around the press and the release are part of the gesture: a
  // `pointerdown` handler that starts a drag on the next frame sees a real one.
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
 * ```ts
 * await wheel(page, 400, 300, { deltaY: -120, ctrlKey: true });
 * ```
 *
 * With no modifier this is `page.mouse.wheel`: a trusted event, which scrolls
 * the page. `ctrlKey` or `shiftKey` switch it to a hand-dispatched `WheelEvent`,
 * because `page.mouse.wheel` drops modifiers — listeners see it, native
 * scrolling does not happen.
 *
 * Either way the pointer is put on the point first and the page has had the
 * event by the time this resolves, so a spec can assert on its effect straight
 * after. The pointer move matters: a trusted wheel fires wherever the pointer
 * already sat, so without it `x, y` would mean the point on one path and
 * nothing at all on the other.
 *
 * @param {Page} page
 * @param {number} x
 * @param {number} y
 * @param {WheelOptions} [opts]
 */
export async function wheel(page, x, y, opts = {}) {
  const { deltaX = 0, deltaY = 0, ctrlKey = false, shiftKey = false } = opts;
  await page.mouse.move(x, y);
  await notch(page, x, y, { deltaX, deltaY, ctrlKey, shiftKey });
}

/**
 * A wheel gesture: `ticks` events at one point, spaced by `tickDelay` ms.
 *
 * ```ts
 * // pinch-zoom in by 400, over 8 notches
 * await wheelBurst(page, 400, 300, { deltaY: -400, ctrlKey: true });
 * ```
 *
 * The deltas are the totals the gesture adds up to. The pointer moves to the
 * point once, not once per tick — a gesture is one movement, and an app with a
 * `mousemove` handler should not have to process `ticks` of them.
 *
 * @param {Page} page
 * @param {number} x
 * @param {number} y
 * @param {WheelBurstOptions} [opts]
 */
export async function wheelBurst(page, x, y, opts = {}) {
  const {
    deltaX = 0,
    deltaY = 0,
    ticks = 8,
    tickDelay = 40,
    ...modifiers
  } = opts;
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

// Private, so nothing about it reaches the declaration. Its options are spelled
// out rather than reusing `WheelOptions`: every field is required here, because
// every caller has already applied the defaults.
/**
 * One notch, at the point, without touching the pointer. Every public entry
 * point puts the pointer on the point first, once per gesture, and the ticks of
 * a burst must not each fire a `mousemove` an app would have to handle.
 *
 * @param {Page} page
 * @param {number} x
 * @param {number} y
 * @param {{ deltaX: number, deltaY: number, ctrlKey: boolean, shiftKey: boolean }} opts
 */
async function notch(page, x, y, { deltaX, deltaY, ctrlKey, shiftKey }) {
  // Two paths because `page.mouse.wheel` drops modifiers, and a pinch-zoom is
  // exactly a wheel with `ctrlKey`. Unmodified it stays on Playwright's own
  // wheel — a trusted event, which scrolls the page like a real notch; a
  // hand-dispatched one would silently stop doing that.
  if (!ctrlKey && !shiftKey) {
    await page.mouse.wheel(deltaX, deltaY);
    // Playwright's wheel resolves once the event is sent, not once the page has
    // it. Wait a frame so this call means the same thing the dispatched path
    // does: the page has seen it, and the next line may assert on the effect.
    // Measured on an empty page, reading the listener's log straight after the
    // call finds it empty every time, and finds the event after one
    // `requestAnimationFrame` every time.
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

// The vocabulary, last on purpose. A `@typedef` comment never attaches to the
// type alias `tsc` synthesizes from it — it is re-emitted where it sat in the
// source. Kept here, the generated declaration reads as the curated function
// docs first and these blocks as a footnote under the types they describe;
// kept at the top, they land in the middle of the file as a wall of tags.
// Line comments like this one are dropped from the emit, so this note stays put.

/**
 * How a straight-line pointer gesture is paced.
 *
 * @typedef {object} StrokeOptions
 * @property {number} [steps] Intermediate positions. `smoothMove` fires
 *   `steps + 1` moves. Default 25.
 * @property {number} [stepDelay] Milliseconds between two moves. Default 12.
 */

/**
 * What a wheel event carries, on top of its deltas.
 *
 * @typedef {object} WheelModifiers
 * @property {boolean} [ctrlKey] A pinch-zoom, in wheel terms. Default false.
 * @property {boolean} [shiftKey] Default false.
 */

/**
 * One wheel event's deltas, and its modifiers.
 *
 * @typedef {object} WheelOptions
 * @property {number} [deltaX] Default 0.
 * @property {number} [deltaY] Default 0.
 * @property {boolean} [ctrlKey] A pinch-zoom, in wheel terms. Default false.
 * @property {boolean} [shiftKey] Default false.
 */

/**
 * A wheel gesture: deltas are totals, split evenly across the ticks.
 *
 * @typedef {object} WheelBurstOptions
 * @property {number} [deltaX] Default 0.
 * @property {number} [deltaY] Default 0.
 * @property {boolean} [ctrlKey] A pinch-zoom, in wheel terms. Default false.
 * @property {boolean} [shiftKey] Default false.
 * @property {number} [ticks] Events fired. Default 8.
 * @property {number} [tickDelay] Milliseconds between two ticks. Default 40.
 */
