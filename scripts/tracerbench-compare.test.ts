import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Which marks bailed, and how the comparer learns it.
 *
 * A mark that bailed compares a real gesture against a no-op, so it must be
 * pulled out of the gated total and reported as drift. The spec records the
 * bails it saw in `counters.json`; before that was read, the comparer inferred
 * them from a 50 ms floor — a guess that is wrong in both directions.
 *
 * Driven as a subprocess, like `profiler-compare.test.ts`: the script is a CLI
 * with top-level side effects, and its stdout is the surface CI reads.
 */

const COMPARE = path.resolve(__dirname, "tracerbench-compare.ts");
const TSX = path.resolve(__dirname, "..", "node_modules", ".bin", "tsx");

type Marks = Record<string, number>;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-compare-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Write one side's Playwright report, plus the `counters.json` the spec leaves
 * beside it. `bailed: undefined` writes no counters file at all — an older
 * control, or a run from before counters existed.
 */
function writeSide(side: string, marks: Marks, bailed?: string[]) {
  const sideDir = path.join(dir, side);
  fs.mkdirSync(sideDir, { recursive: true });

  const report = {
    suites: [
      {
        title: "tracerbench.spec.ts",
        specs: [
          {
            title: "the bench scenario",
            tests: [
              {
                results: [
                  {
                    duration: 0,
                    steps: Object.entries(marks).map(([title, duration]) => ({
                      title,
                      duration,
                    })),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const reportPath = path.join(sideDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report));

  if (bailed !== undefined) {
    fs.writeFileSync(
      path.join(sideDir, "counters.json"),
      JSON.stringify({ schemaVersion: 1, marks: {}, bailed }),
    );
  }
  return reportPath;
}

function compare(control: string, experiment: string) {
  return execFileSync(
    TSX,
    [COMPARE, control, experiment, "--md", path.join(dir, "comment.md")],
    { encoding: "utf8" },
  );
}

describe("bail detection", () => {
  it("believes the spec over the floor: an expensive mark that bailed is drift", () => {
    // A mark can bail on a count guard and still cost real time. Both sides
    // sit far above the floor here, so the floor alone sees nothing.
    const control = writeSide("control", { steady: 1000, guarded: 1200 }, [
      "guarded",
    ]);
    const experiment = writeSide(
      "experiment",
      { steady: 1000, guarded: 1300 },
      [],
    );

    const out = compare(control, experiment);

    expect(out).toContain("1 bailed on one side");
    // Pulled out of the gated total: 1000 a side, not 2200 against 2300.
    expect(out).toMatch(/Total\s+1000ms\s+1000ms/);
  });

  it("believes the spec over the floor: a cheap mark that did not bail is not drift", () => {
    // Under 50 ms on one side and above it on the other — the floor's own
    // definition of a bail — but the spec says both sides ran it.
    const control = writeSide("control", { steady: 1000, guarded: 10 }, []);
    const experiment = writeSide(
      "experiment",
      { steady: 1000, guarded: 200 },
      [],
    );

    const out = compare(control, experiment);

    expect(out).not.toContain("Step drift");
    expect(out).toMatch(/Total\s+1010ms\s+1200ms/);
  });

  it("falls back to the floor when neither side wrote its bails", () => {
    const control = writeSide("control", { steady: 1000, guarded: 10 });
    const experiment = writeSide("experiment", { steady: 1000, guarded: 200 });

    const out = compare(control, experiment);

    expect(out).toContain("1 bailed on one side");
    expect(out).toMatch(/Total\s+1000ms\s+1000ms/);
  });

  it("falls back to the floor when only one side wrote its bails", () => {
    // The control predates the field; the experiment has it. One side's ground
    // truth cannot be compared against the other side's silence.
    const control = writeSide("control", { steady: 1000, guarded: 10 });
    const experiment = writeSide(
      "experiment",
      { steady: 1000, guarded: 200 },
      [],
    );

    const out = compare(control, experiment);

    expect(out).toContain("1 bailed on one side");
  });
});
