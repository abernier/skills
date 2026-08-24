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
import type { Page } from "@playwright/test";
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
export declare function smoothMove(page: Page, fromX: number, fromY: number, toX: number, toY: number, opts?: StrokeOptions): Promise<void>;
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
export declare function smoothDrag(page: Page, fromX: number, fromY: number, toX: number, toY: number, opts?: StrokeOptions): Promise<void>;
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
export declare function wheel(page: Page, x: number, y: number, opts?: WheelOptions): Promise<void>;
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
export declare function wheelBurst(page: Page, x: number, y: number, opts?: WheelBurstOptions): Promise<void>;
export type StrokeOptions = {
    /**
     * Intermediate positions. `smoothMove` fires
     * `steps + 1` moves. Default 25.
     */
    steps?: number;
    /**
     * Milliseconds between two moves. Default 12.
     */
    stepDelay?: number;
};
export type WheelModifiers = {
    /**
     * A pinch-zoom, in wheel terms. Default false.
     */
    ctrlKey?: boolean;
    /**
     * Default false.
     */
    shiftKey?: boolean;
};
export type WheelOptions = {
    /**
     * Default 0.
     */
    deltaX?: number;
    /**
     * Default 0.
     */
    deltaY?: number;
    /**
     * A pinch-zoom, in wheel terms. Default false.
     */
    ctrlKey?: boolean;
    /**
     * Default false.
     */
    shiftKey?: boolean;
};
export type WheelBurstOptions = {
    /**
     * Default 0.
     */
    deltaX?: number;
    /**
     * Default 0.
     */
    deltaY?: number;
    /**
     * A pinch-zoom, in wheel terms. Default false.
     */
    ctrlKey?: boolean;
    /**
     * Default false.
     */
    shiftKey?: boolean;
    /**
     * Events fired. Default 8.
     */
    ticks?: number;
    /**
     * Milliseconds between two ticks. Default 40.
     */
    tickDelay?: number;
};
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
