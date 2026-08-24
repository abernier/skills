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
 * Driven as a subprocess, like `profiler.compare.test.ts`: the script is a CLI
 * with top-level side effects, and its stdout is the surface CI reads.
 */

const COMPARE = path.resolve(__dirname, "tracerbench.compare.ts");
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
 * beside it. `bailed` and `frames` both absent writes no counters file at all —
 * an older control, or a run from before counters existed.
 */
function writeSide(
  side: string,
  marks: Marks,
  bailed?: string[],
  frames?: Record<string, number>,
) {
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

  if (bailed !== undefined || frames !== undefined) {
    fs.writeFileSync(
      path.join(sideDir, "counters.json"),
      JSON.stringify({
        schemaVersion: 1,
        marks: Object.fromEntries(
          Object.entries(frames ?? {}).map(([mark, count]) => [
            mark,
            { frames: count, drawCalls: 0 },
          ]),
        ),
        bailed: bailed ?? [],
      }),
    );
  }
  return reportPath;
}

/**
 * The report Playwright's JSON reporter writes when its `webServer` never
 * starts: no suite ran, one error saying why. A perfectly valid file, and not
 * a measurement — which is the whole of the bug the guard below covers.
 */
function writeUnrunSide(side: string) {
  const sideDir = path.join(dir, side);
  fs.mkdirSync(sideDir, { recursive: true });
  const reportPath = path.join(sideDir, "report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      suites: [],
      errors: [
        {
          message:
            "Error: http://localhost:4200 is already used, make sure that nothing is running on the port/url",
        },
      ],
    }),
  );
  return reportPath;
}

/** Exit code and stdout — both are surfaces CI reads. */
function run(control: string, experiment: string, ...flags: string[]) {
  const argv = [
    COMPARE,
    control,
    experiment,
    "--md",
    path.join(dir, "comment.md"),
    ...flags,
  ];
  try {
    return { status: 0, stdout: execFileSync(TSX, argv, { encoding: "utf8" }) };
  } catch (err) {
    const failure = err as { status?: number; stdout?: string };
    return { status: failure.status ?? -1, stdout: failure.stdout ?? "" };
  }
}

function compare(control: string, experiment: string, ...flags: string[]) {
  return run(control, experiment, ...flags).stdout;
}

const commentMd = () => fs.readFileSync(path.join(dir, "comment.md"), "utf8");

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

describe("no threshold, no gate", () => {
  it("measures a regression and reports it without judging it", () => {
    // Doubled wall clock — a width of any plausible size would fail this.
    const control = writeSide("control", { steady: 1000 });
    const experiment = writeSide("experiment", { steady: 2000 });

    const { status, stdout } = run(control, experiment);

    expect(status).toBe(0);
    expect(stdout).toContain("+100.0%");
    expect(stdout).toContain("no threshold is configured");
    expect(stdout).not.toContain("within");
    expect(commentMd()).toContain("**NO GATE**");
    expect(commentMd()).not.toContain("**PASS**");
  });

  it("still writes the numbers a reader came for", () => {
    const control = writeSide("control", { steady: 1000, other: 500 });
    const experiment = writeSide("experiment", { steady: 2000, other: 400 });

    const { status } = run(control, experiment);
    const md = commentMd();

    expect(status).toBe(0);
    expect(md).toContain("| **Total** | **1500ms** | **2400ms** | **+60.0%** |");
    expect(md).toContain("xychart-beta");
  });
});

describe("frames declared while ms is absent", () => {
  const sides = (ctrlFrames: number, expFrames: number, expMs: number) => ({
    control: writeSide("control", { steady: 1000 }, [], { steady: ctrlFrames }),
    experiment: writeSide("experiment", { steady: expMs }, [], {
      steady: expFrames,
    }),
  });

  it("fails on frames alone", () => {
    const { control, experiment } = sides(100, 200, 1000);

    const { status, stdout } = run(
      control,
      experiment,
      "--frames-threshold",
      "10",
    );

    expect(status).toBe(1);
    expect(stdout).toContain("frames +100.0% exceeds threshold of +10% frames");
  });

  it("lets wall clock through however far it moved", () => {
    const { control, experiment } = sides(100, 100, 5000);

    const { status, stdout } = run(
      control,
      experiment,
      "--frames-threshold",
      "10",
    );

    expect(status).toBe(0);
    expect(stdout).toContain("frames 0.0% is within threshold of +10% frames");
    expect(stdout).toContain("ms +400.0% ungated");
  });
});

describe("nothing to compare", () => {
  it("a leg that never ran is not a pass", () => {
    // The run this was found on: the control leg's web server never started,
    // the JSON reporter wrote its report anyway, and the comparison over the
    // empty intersection read `0ms` against `0ms` — `+0.0%`, inside any width.
    const control = writeUnrunSide("control");
    const experiment = writeSide("experiment", { steady: 1000, other: 500 });

    const { status, stdout } = run(control, experiment, "--threshold", "25");

    expect(status).toBe(1);
    expect(stdout).toContain("nothing was compared");
    expect(stdout).toContain("the control leg timed no marks at all");
    expect(commentMd()).toContain("**NO DATA**");
    expect(commentMd()).not.toContain("**PASS**");
  });

  it("and is not a pass with no width declared either", () => {
    // An absent width says "do not judge my numbers". It never said "do not
    // tell me the bench did not run".
    const control = writeUnrunSide("control");
    const experiment = writeSide("experiment", { steady: 1000 });

    const { status } = run(control, experiment);

    expect(status).toBe(1);
    expect(commentMd()).toContain("**NO DATA**");
    expect(commentMd()).not.toContain("**NO GATE**");
  });

  it("a report that was never written at all is the same fact", () => {
    const experiment = writeSide("experiment", { steady: 1000 });

    const { status } = run(
      path.join(dir, "control", "report.json"),
      experiment,
      "--threshold",
      "25",
    );

    expect(status).toBe(1);
    expect(commentMd()).toContain("**NO DATA**");
  });

  it("a leg that died partway is the same fact, though its report is not empty", () => {
    // The second reproduction, in another repo: `0 compared, 12 only on
    // experiment, 1 only on control`. The control side is not empty, so a
    // test on the report's emptiness reads it as a healthy side. The
    // intersection is empty, and that is what is gated.
    const control = writeSide("control", { boot: 400 });
    const experiment = writeSide("experiment", { mount: 1000, tick: 500 });

    const { status, stdout } = run(control, experiment, "--threshold", "25");

    expect(status).toBe(1);
    expect(stdout).toContain("no mark in common");
    expect(commentMd()).toContain("**NO DATA**");
  });

  it("but a mark missing from one side still compares the rest", () => {
    // The line the guard must not cross. A side that ran and had nothing to
    // say about one mark is drift — reported, excluded, and still a
    // comparison of everything else.
    const control = writeSide("control", { steady: 1000 });
    const experiment = writeSide("experiment", { steady: 1100, added: 400 });

    const { status, stdout } = run(control, experiment, "--threshold", "25");

    expect(status).toBe(0);
    expect(stdout).toContain("1 compared, 1 only on experiment");
    expect(commentMd()).toContain("**PASS**");
  });

  it("every shared mark bailing is not a comparison either", () => {
    // One bailed mark is a documented case; every mark bailing leaves the
    // gated total summing nothing at all.
    const control = writeSide("control", { guarded: 1000 }, ["guarded"]);
    const experiment = writeSide("experiment", { guarded: 20 }, []);

    const { status, stdout } = run(control, experiment, "--threshold", "25");

    expect(status).toBe(1);
    expect(stdout).toContain("every shared mark bailed on one side");
    expect(commentMd()).toContain("**NO DATA**");
  });
});
