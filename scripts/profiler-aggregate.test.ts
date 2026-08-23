import { describe, expect, it } from "vitest";
import {
  aggregateCommits,
  type CommitRecord,
  type RenderRecord,
} from "./profiler-aggregate.ts";

/**
 * Tiny helper to keep the test bodies free of repetitive scaffolding —
 * we never care about realistic durations here, just the routing logic.
 */
function render(
  name: string,
  cause: RenderRecord["cause"],
  selfTime = 1,
  baseTime = 1,
): RenderRecord {
  return { name, cause, selfTime, baseTime };
}

function commit(...renders: RenderRecord[]): CommitRecord {
  return { renders };
}

describe("aggregateCommits", () => {
  it("returns empty aggregates for an empty commit log", () => {
    expect(aggregateCommits([])).toEqual({ byComponent: {}, totalRenders: 0 });
  });

  it("counts one render per record across components", () => {
    const out = aggregateCommits([
      commit(
        render("Foo", { kind: "mount" }),
        render("Bar", { kind: "mount" }),
      ),
      commit(render("Foo", { kind: "parent" })),
    ]);

    expect(out.totalRenders).toBe(3);
    expect(out.byComponent.Foo.renders).toBe(2);
    expect(out.byComponent.Bar.renders).toBe(1);
  });

  it("routes each render to the matching cause bucket", () => {
    const out = aggregateCommits([
      commit(
        render("X", { kind: "mount" }),
        render("X", { kind: "props", changed: ["a"] }),
        render("X", { kind: "state" }),
        render("X", { kind: "context", names: ["Theme"] }),
        render("X", { kind: "parent" }),
        render("X", { kind: "force" }),
      ),
    ]);

    expect(out.byComponent.X.causes).toEqual({
      mount: 1,
      props: 1,
      state: 1,
      context: 1,
      parent: 1,
      force: 1,
    });
  });

  it("builds a histogram over changed prop names", () => {
    const out = aggregateCommits([
      commit(render("X", { kind: "props", changed: ["xywh", "scale"] })),
      commit(render("X", { kind: "props", changed: ["xywh"] })),
      commit(render("X", { kind: "props", changed: [] })),
    ]);

    // The empty changed[] still counts as a "props" cause but contributes
    // no entry to the histogram — that's the contract.
    expect(out.byComponent.X.causes.props).toBe(3);
    expect(out.byComponent.X.changedProps).toEqual({ xywh: 2, scale: 1 });
  });

  it("builds a histogram over changed context names", () => {
    const out = aggregateCommits([
      commit(render("X", { kind: "context", names: ["Theme"] })),
      commit(render("X", { kind: "context", names: ["Theme", "Auth"] })),
    ]);

    expect(out.byComponent.X.changedContexts).toEqual({ Theme: 2, Auth: 1 });
  });

  it("does not record changedProps for non-props causes", () => {
    // Defensive: a future bug where we accidentally fold mount-cause renders
    // into the props histogram would silently inflate prop deltas in the
    // compare report. Pin the contract.
    const out = aggregateCommits([
      commit(render("X", { kind: "mount" })),
      commit(render("X", { kind: "state" })),
      commit(render("X", { kind: "parent" })),
    ]);

    expect(out.byComponent.X.changedProps).toEqual({});
    expect(out.byComponent.X.changedContexts).toEqual({});
  });

  it("sums durations across all renders for a component", () => {
    const out = aggregateCommits([
      commit(
        render("X", { kind: "mount" }, 2, 5),
        render("X", { kind: "props", changed: ["a"] }, 3, 4),
      ),
      commit(render("X", { kind: "parent" }, 1, 1)),
    ]);

    expect(out.byComponent.X.selfTimeMs).toBeCloseTo(6);
    expect(out.byComponent.X.baseTimeMs).toBeCloseTo(10);
  });

  it("keeps each component's bucket independent", () => {
    const out = aggregateCommits([
      commit(
        render("Foo", { kind: "props", changed: ["fooProp"] }),
        render("Bar", { kind: "props", changed: ["barProp"] }),
      ),
    ]);

    expect(out.byComponent.Foo.changedProps).toEqual({ fooProp: 1 });
    expect(out.byComponent.Bar.changedProps).toEqual({ barProp: 1 });
    expect(out.byComponent.Foo.causes.props).toBe(1);
    expect(out.byComponent.Bar.causes.props).toBe(1);
  });
});
