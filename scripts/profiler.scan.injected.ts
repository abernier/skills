/**
 * React render-cause recorder, bundled as an IIFE and injected via Playwright's
 * `addInitScript` BEFORE React boots. Patches `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`
 * (via `bippy.instrument`) to capture, for every commit, which fibers rendered
 * and *why* — the same data the React DevTools "Why did this render?" panel shows.
 *
 * This file is **never** imported by the app or by the spec directly. It is
 * built into `profiler-results/scan-bundle.js` by `profiler.scan.setup.mjs`
 * beside it, and shipped to the page as raw script content. That keeps the
 * dependency on `bippy` and any version drift contained to test infrastructure
 * — both the control and the experiment branches receive byte-identical
 * instrumentation.
 *
 * Stays TypeScript where its neighbour is `.mjs`: nothing ever imports this
 * file, so Node's `node_modules` type-stripping refusal never applies. esbuild
 * reads it as an entry point and does its own transpilation.
 *
 * `bippy` is resolved from the repo being measured, never from this package.
 *
 * Output: `window.__renderScan__` exposes `{ reset(), snapshot() }`. The spec
 * snapshots between scenario steps and resets so each step gets clean data.
 */

import {
  getDisplayName,
  getTimings,
  instrument,
  isCompositeFiber,
  secure,
  traverseContexts,
  traverseProps,
  traverseRenderedFibers,
  traverseState,
  type Fiber,
} from "bippy";

// This file is the producer of these shapes; `bench.types.d.mts` is where they
// are written down, and where `profiler.aggregate.ts` and every consuming repo's
// spec read them. `import type` and nothing else: there is no runtime module
// behind that file, and esbuild never sees this specifier because TypeScript
// erases the import before the bundle is resolved.
import type {
  CommitRecord,
  RenderCause,
  RenderRecord,
} from "./bench.types.d.mts";

type ScanApi = {
  reset(): void;
  snapshot(): CommitRecord[];
};

declare global {
  interface Window {
    __renderScan__?: ScanApi;
  }
}

let commits: CommitRecord[] = [];

/**
 * Compute the primary cause of a fiber's render.
 *
 * The order encodes a heuristic taken from React DevTools: a real "why did this
 * render?" answer prioritises specific changes (mount, props, state, context)
 * over the catch-all "parent rendered". Force-update is rare and only applies
 * to class components; everything else is "parent".
 */
function classify(fiber: Fiber): RenderCause {
  if (!fiber.alternate) {
    return { kind: "mount" };
  }

  const changedProps: string[] = [];
  try {
    traverseProps(fiber, (propName, next, prev) => {
      if (!Object.is(next, prev)) changedProps.push(String(propName));
    });
  } catch {
    /* fiber shape may differ across React versions — bail silently */
  }
  if (changedProps.length > 0) {
    return { kind: "props", changed: changedProps };
  }

  let stateChanged = false;
  try {
    traverseState(fiber, (next, prev) => {
      if (!Object.is(next, prev)) stateChanged = true;
    });
  } catch {
    /* same — defensive */
  }
  if (stateChanged) {
    return { kind: "state" };
  }

  const changedContexts: string[] = [];
  try {
    traverseContexts(fiber, (next, prev) => {
      if (!Object.is(next?.memoizedValue, prev?.memoizedValue)) {
        // `_currentValue` is the context's live value — typed as `{}`, so the
        // fallback name it may carry (a provider object naming itself) needs a
        // shape to be read through.
        const currentValue = next?.context?._currentValue as
          | { name?: unknown }
          | undefined;
        const ctxName = next?.context?.displayName ?? currentValue?.name ?? "?";
        changedContexts.push(String(ctxName));
      }
    });
  } catch {
    /* same — defensive */
  }
  if (changedContexts.length > 0) {
    return { kind: "context", names: changedContexts };
  }

  return { kind: "parent" };
}

instrument(
  secure({
    onCommitFiberRoot(_rendererID, root) {
      const renders: RenderRecord[] = [];
      try {
        traverseRenderedFibers(root, (fiber) => {
          // Skip host fibers (DOM elements), fragments, providers, consumers,
          // suspense boundaries — they bloat the data without adding signal.
          // We want user components: functions, classes, memo, forwardRef.
          if (!isCompositeFiber(fiber)) return;
          const name = getDisplayName(fiber);
          if (!name) return;
          const timings = getTimings(fiber);
          renders.push({
            name,
            cause: classify(fiber),
            selfTime: timings.selfTime,
            // `getTimings` exposes `selfTime` / `totalTime` only — the base
            // duration is read off the fiber. It used to be taken from a
            // `timings.baseTime` that never existed, so every base time
            // reaching the aggregator was `undefined`, and its running sum
            // `NaN`.
            baseTime: fiber.treeBaseDuration ?? 0,
          });
        });
      } catch {
        /* never let a bad commit bring down the page */
      }
      commits.push({ renders });
    },
  }),
);

const api: ScanApi = {
  reset() {
    commits = [];
  },
  snapshot() {
    // Return a structured-cloneable copy so Playwright's `evaluate` can ferry
    // it back to the Node side without complaints about non-serialisable bits.
    return commits.map((c) => ({
      renders: c.renders.map((r) => ({ ...r, cause: { ...r.cause } })),
    }));
  },
};

window.__renderScan__ = api;
