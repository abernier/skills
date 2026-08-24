import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------
//
// `profiler.sh` runs this file as a program, through the measured repo's own
// `tsx`, once per side. Driving it as a subprocess is the only way to assert on
// the exit code that decides whether the bench continues — and every assertion
// below is about the same thing: a commit log this cannot fold must stop the
// run, because a report with an empty `byComponent` reads as "no regressions".

const AGGREGATE = path.resolve(__dirname, "profiler-aggregate.ts");

/** The repo this file sits in — its `tsx`, exactly as `profiler.sh` finds it. */
const CONSUMER = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: __dirname,
  encoding: "utf8",
}).trim();
const TSX = path.resolve(CONSUMER, "node_modules", ".bin", "tsx");

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

type CliRun = { exitCode: number; stdout: string; stderr: string; out: string };

/**
 * Write `input` (verbatim, so a test can hand over something that is not even
 * JSON), run the CLI over it, and read back whatever it produced.
 */
function runCli(
  input: string | undefined,
  args?: string[],
  script: string = AGGREGATE,
): CliRun {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profiler-aggregate-"));
  tmpDirs.push(dir);
  const inPath = path.join(dir, "commits.json");
  const outPath = path.join(dir, "report.json");
  if (input !== undefined) fs.writeFileSync(inPath, input, "utf8");

  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(TSX, [script, ...(args ?? [inPath, outPath])], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    exitCode = err.status ?? 1;
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? "";
  }
  const out = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
  return { exitCode, stdout, stderr, out };
}

/** A commit log with one step, shaped exactly as the spec must write it. */
function commitLog(step: Record<string, unknown>) {
  return JSON.stringify({
    generatedAt: "2026-01-01T00:00:00.000Z",
    url: "http://localhost:4301/",
    schemaVersion: 2,
    steps: [{ step: "orbit", durationMs: 10, totalCommits: 2, byId: {}, ...step }],
  });
}

describe("profiler-aggregate CLI", () => {
  it("folds the commit log into the byComponent report the comparer reads", () => {
    const r = runCli(
      commitLog({
        commits: [
          {
            renders: [
              {
                name: "ZoomPan",
                cause: { kind: "props", changed: ["xywh"] },
                selfTime: 0.5,
                baseTime: 1,
              },
            ],
          },
          { renders: [] },
        ],
      }),
    );

    expect(r.exitCode, r.stderr).toBe(0);
    const report = JSON.parse(r.out);
    expect(report.steps[0].byComponent.ZoomPan.renders).toBe(1);
    expect(report.steps[0].byComponent.ZoomPan.changedProps).toEqual({
      xywh: 1,
    });
    // The raw log does not travel any further — the comparer never reads it.
    expect(report.steps[0]).not.toHaveProperty("commits");
  });

  it("keeps every other field of the report envelope verbatim", () => {
    const r = runCli(
      JSON.stringify({
        generatedAt: "2026-01-01T00:00:00.000Z",
        url: "http://localhost:4301/",
        schemaVersion: 2,
        // Neither key is the harness's business, and both are in the wild.
        diagnostics: { viewport: "1280x720" },
        failures: [],
        steps: [
          {
            step: "orbit",
            durationMs: 10,
            totalCommits: 2,
            byId: { root: { mount: { count: 1, actualMs: 1, baseMs: 2 } } },
            commits: [],
          },
        ],
      }),
    );

    expect(r.exitCode, r.stderr).toBe(0);
    const report = JSON.parse(r.out);
    expect(report.schemaVersion).toBe(2);
    expect(report.diagnostics).toEqual({ viewport: "1280x720" });
    expect(report.steps[0].byId.root.mount.count).toBe(1);
    expect(report.steps[0].durationMs).toBe(10);
  });

  it("counts the commits when the spec did not, and defers to it when it did", () => {
    const commits = [{ renders: [] }, { renders: [] }, { renders: [] }];
    const derived = JSON.parse(runCli(commitLog({ commits })).out);
    expect(derived.steps[0].scanCommits).toBe(3);

    const declared = JSON.parse(
      runCli(commitLog({ commits, scanCommits: 3 })).out,
    );
    expect(declared.steps[0].scanCommits).toBe(3);
  });

  it("refuses a missing input file rather than writing an empty report", () => {
    const r = runCli(undefined);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/cannot read/);
    expect(r.out).toBe("");
  });

  it("refuses a file that is not JSON", () => {
    const r = runCli("not json at all");
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/not valid JSON/);
    expect(r.out).toBe("");
  });

  it("refuses a step that carries no commit log", () => {
    // The shape a spec would write if it kept aggregating on its own side.
    const r = runCli(commitLog({ byComponent: {} }));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/no commits\[\]/);
    expect(r.out).toBe("");
  });

  it("refuses a run with no steps at all", () => {
    const r = runCli(JSON.stringify({ steps: [] }));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/empty steps\[\]/);
    expect(r.out).toBe("");
  });

  it("refuses a render whose cause the recorder never produces", () => {
    const r = runCli(
      commitLog({
        commits: [
          {
            renders: [
              {
                name: "ZoomPan",
                cause: { kind: "vibes" },
                selfTime: 1,
                baseTime: 1,
              },
            ],
          },
        ],
      }),
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/unknown cause kind/);
    expect(r.out).toBe("");
  });

  it("refuses a props render with no changed[] — aggregating it would throw", () => {
    const r = runCli(
      commitLog({
        commits: [
          {
            renders: [
              { name: "ZoomPan", cause: { kind: "props" }, selfTime: 1, baseTime: 1 },
            ],
          },
        ],
      }),
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/changed\[\] names/);
  });

  it("still runs when invoked through a symlink, the way pnpm installs it", () => {
    // `node_modules/@abernier/skills` is a symlink into pnpm's store, so the
    // path `profiler.sh` types and the path the module reports for itself are
    // two different strings for one file. Comparing them verbatim made the
    // program silently do nothing — exit 0, no report — which the fixture
    // above cannot see, because it invokes the real path.
    const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), "profiler-agg-link-"));
    tmpDirs.push(linkDir);
    const link = path.join(linkDir, "skills");
    fs.symlinkSync(path.resolve(__dirname, ".."), link, "dir");

    const r = runCli(
      commitLog({ commits: [{ renders: [] }] }),
      undefined,
      path.join(link, "scripts", "profiler-aggregate.ts"),
    );

    expect(r.exitCode, r.stderr).toBe(0);
    expect(JSON.parse(r.out).steps[0].byComponent).toEqual({});
  });

  it("prints its usage when an output path is missing", () => {
    const r = runCli(commitLog({ commits: [] }), ["/nowhere/commits.json"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/Usage: tsx .*profiler-aggregate\.ts/);
  });
});
