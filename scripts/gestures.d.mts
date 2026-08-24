import type { Page } from "@playwright/test";

/** How a straight-line pointer gesture is paced. */
export interface StrokeOptions {
  /** Intermediate positions. `smoothMove` fires `steps + 1` moves. Default 25. */
  steps?: number;
  /** Milliseconds between two moves. Default 12. */
  stepDelay?: number;
}

/** What a wheel event carries, on top of its deltas. */
export interface WheelModifiers {
  /** A pinch-zoom, in wheel terms. Default false. */
  ctrlKey?: boolean;
  /** Default false. */
  shiftKey?: boolean;
}

/** One wheel event's deltas, and its modifiers. */
export interface WheelOptions extends WheelModifiers {
  /** Default 0. */
  deltaX?: number;
  /** Default 0. */
  deltaY?: number;
}

/** A wheel gesture: deltas are totals, split evenly across the ticks. */
export interface WheelBurstOptions extends WheelOptions {
  /** Events fired. Default 8. */
  ticks?: number;
  /** Milliseconds between two ticks. Default 40. */
  tickDelay?: number;
}

/**
 * Move the pointer along a straight line, one event at a time.
 *
 * ```ts
 * await smoothMove(page, 100, 100, 400, 300, { steps: 40, stepDelay: 8 });
 * ```
 *
 * `page.mouse.move(x, y, { steps })` fires its intermediate moves back to back.
 * The delay between them is what makes a lap realistic.
 */
export declare function smoothMove(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  opts?: StrokeOptions,
): Promise<void>;

/** `smoothMove`, with the button held down for the whole line. */
export declare function smoothDrag(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  opts?: StrokeOptions,
): Promise<void>;

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
 * Either way the page has had the event by the time this resolves, so a spec
 * can assert on its effect straight after.
 */
export declare function wheel(
  page: Page,
  x: number,
  y: number,
  opts?: WheelOptions,
): Promise<void>;

/**
 * A wheel gesture: `ticks` events at one point, spaced by `tickDelay` ms.
 *
 * ```ts
 * // pinch-zoom in by 400, over 8 notches
 * await wheelBurst(page, 400, 300, { deltaY: -400, ctrlKey: true });
 * ```
 *
 * The deltas are the totals the gesture adds up to. The pointer moves to the
 * point first, then every tick goes through `wheel`.
 */
export declare function wheelBurst(
  page: Page,
  x: number,
  y: number,
  opts?: WheelBurstOptions,
): Promise<void>;
