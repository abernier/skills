/**
 * The wire contract between a consuming repo's bench specs and this package's
 * folding and comparing programs. Declarations only — there is no runtime file
 * behind this module, so every import of it must be an `import type`.
 *
 * ```ts
 * // e2e/profiler.spec.ts
 * import type {
 *   CommitRecord,
 *   PerfIdStats,
 * } from "@abernier/skills/bench-types";
 * ```
 *
 * A value import of a `.ts` file inside `node_modules` is what the specs used
 * to avoid by re-declaring these shapes by hand: Node refuses to strip types
 * under `node_modules` ("Stripping types is currently unsupported for files
 * under node_modules"). `import type` never reaches Node — TypeScript erases it
 * during compilation — so the refusal does not apply, and one declaration can
 * serve every repo.
 *
 * These are the shapes the bippy recorder (`profiler.scan.injected.ts`)
 * produces and `profiler.aggregate.ts` consumes. The recorder is the producer
 * of truth; this file mirrors it.
 */

/**
 * Why one fiber rendered, as classified by the recorder.
 *
 * The order the recorder tries them in is the React DevTools heuristic —
 * a specific change (mount, props, state, context) beats the catch-all
 * "my parent rendered". `force` only ever comes from a class component's
 * `forceUpdate`.
 */
export type RenderCause =
  | { kind: "mount" }
  | { kind: "props"; changed: string[] }
  | { kind: "state" }
  | { kind: "context"; names: string[] }
  | { kind: "parent" }
  | { kind: "force" };

/** One fiber's render inside a commit. */
export type RenderRecord = {
  /** Component display name. `"Anonymous"` for an unnamed component. */
  name: string;
  /** Primary cause classification. */
  cause: RenderCause;
  /** The fiber's `actualDuration` — its own time, children excluded, in ms. */
  selfTime: number;
  /** The fiber's `treeBaseDuration` — estimated time without memoization, in ms. */
  baseTime: number;
};

/**
 * One React commit, as `window.__renderScan__.snapshot()` returns it. A step's
 * raw commit log is an array of these, and it is what a spec writes to
 * `$PROFILER_COMMITS`; `profiler.aggregate.ts` folds it into `byComponent`.
 */
export type CommitRecord = {
  renders: RenderRecord[];
};

/**
 * One `<React.Profiler>` zone's totals, as `window.__perfStats.snapshot()`
 * returns them, keyed by the zone's `id`. Coarse and hand-placed, where
 * {@link CommitRecord} is per-fiber and automatic — `profiler.compare.ts`
 * reports these as an advisory canary and never gates on them.
 */
export type PerfIdStats = {
  mount: { count: number; actualMs: number; baseMs: number };
  update: { count: number; actualMs: number; baseMs: number };
};
