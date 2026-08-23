/**
 * Pure aggregation helpers shared between the Playwright spec
 * (`e2e/profiler.spec.ts`) and the comparison script
 * (`scripts/profiler-compare.ts`).
 *
 * Lives outside `e2e/` so vitest picks up its tests (the default config
 * excludes `e2e/**` because Playwright owns that directory).
 */

/**
 * Cause classification produced by the bippy recorder. Mirrors the union in
 * `e2e/profiler-scan.injected.ts` exactly — this file is the canonical
 * declaration both the spec and the recorder validate against.
 */
export type RenderCause =
  | { kind: "mount" }
  | { kind: "props"; changed: string[] }
  | { kind: "state" }
  | { kind: "context"; names: string[] }
  | { kind: "parent" }
  | { kind: "force" };

/** One render entry inside a commit, as captured by the bippy recorder. */
export type RenderRecord = {
  name: string;
  cause: RenderCause;
  selfTime: number;
  baseTime: number;
};

/** One commit from the recorder. */
export type CommitRecord = {
  renders: RenderRecord[];
};

/**
 * Per-component aggregate folded from a step's raw commit log. Compact
 * enough to round-trip through JSON without bloating the report; rich
 * enough to drive the cause-aware diffs in `profiler-compare.ts`.
 */
export type ComponentStats = {
  /** Total renders across all commits in this step. */
  renders: number;
  /** Sum of `actualDuration` self-time, in ms. */
  selfTimeMs: number;
  /** Sum of `baseDuration`, in ms. */
  baseTimeMs: number;
  causes: {
    mount: number;
    props: number;
    state: number;
    context: number;
    parent: number;
    force: number;
  };
  /** Histogram of changed-prop names → render count. */
  changedProps: Record<string, number>;
  /** Histogram of changed-context names. */
  changedContexts: Record<string, number>;
};

/**
 * Fold a step's commit log into per-component aggregates.
 *
 * Keeps the report compact (`profiler-compare.ts` doesn't need every
 * individual render) while preserving enough detail to surface
 * "ZoomPan rendered 50 times in this step, 80% because xywh changed".
 *
 * @param commits - Raw commit log captured between `reset()` and `snapshot()`.
 *
 * @example
 * const { byComponent, totalRenders } = aggregateCommits(commits);
 * console.log(byComponent.ZoomPan.causes.props); // 40
 */
export function aggregateCommits(commits: CommitRecord[]): {
  byComponent: Record<string, ComponentStats>;
  totalRenders: number;
} {
  const out: Record<string, ComponentStats> = {};
  let totalRenders = 0;
  for (const commit of commits) {
    for (const r of commit.renders) {
      totalRenders++;
      const slot = (out[r.name] ??= emptyStats());
      slot.renders++;
      slot.selfTimeMs += r.selfTime;
      slot.baseTimeMs += r.baseTime;
      slot.causes[r.cause.kind]++;
      if (r.cause.kind === "props") {
        for (const p of r.cause.changed) {
          slot.changedProps[p] = (slot.changedProps[p] ?? 0) + 1;
        }
      } else if (r.cause.kind === "context") {
        for (const c of r.cause.names) {
          slot.changedContexts[c] = (slot.changedContexts[c] ?? 0) + 1;
        }
      }
    }
  }
  return { byComponent: out, totalRenders };
}

function emptyStats(): ComponentStats {
  return {
    renders: 0,
    selfTimeMs: 0,
    baseTimeMs: 0,
    causes: {
      mount: 0,
      props: 0,
      state: 0,
      context: 0,
      parent: 0,
      force: 0,
    },
    changedProps: {},
    changedContexts: {},
  };
}
