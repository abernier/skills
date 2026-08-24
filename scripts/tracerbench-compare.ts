#!/usr/bin/env tsx

/**
 * Compare two Playwright JSON reports (control vs experiment) and print a
 * duration-comparison table to stdout.  Optionally writes a Markdown summary
 * to a file (for posting as a PR comment).
 *
 * Usage:
 *   tsx scripts/tracerbench-compare.ts <control.json> <experiment.json> \
 *     [--md <output.md>] [--threshold <percent>] [--frames-threshold <percent>]
 *
 * Two totals are gated: wall-clock `ms` and rendered `frames` (read from a
 * `counters.json` sitting next to each report).  Draw calls are reported for
 * context and never gated.  Each threshold is applied to the **sum** over all
 * marks, not per-mark, so that a noisy individual mark cannot fail a run.
 *
 * They are gated separately because they are separate signals: wall clock
 * answers "how long did it take", frames answers "how much did we redraw",
 * and one can move while the other does not.  A single width across both
 * would have to be the looser of the two, which throws the tighter signal
 * away.
 *
 * A width is a calibration, not a preference.  Run the bench with the same
 * build on both sides, several times over, and the spread it reports is the
 * floor: under it the gate fails on noise, far above it the gate stops
 * catching regressions.  The two signals rarely calibrate to the same number
 * — a repo that redraws only on demand sees far less spread on frames than on
 * wall clock — so each gets its own.
 *
 * Which makes a width a property of the repo, not of this script: it is
 * recorded in `bench.json`, and the shell wrapper passes it in.  There is no
 * default, because there is no width that is right for a repo this script has
 * never measured.  Given no `--threshold` and no `--frames-threshold`, the run
 * still measures and still writes its table and its markdown — it just exits 0
 * without judging.  A repo that wants a gate declares its width.
 *
 * `--frames-threshold` alone gates frames alone; `--threshold` alone gates both,
 * frames borrowing the ms width.  And a repo whose spec writes no
 * `counters.json` gets the wall-clock comparison alone, with the frames and
 * draw-call columns dormant.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

interface PlaywrightStep {
  title: string;
  duration: number;
}

interface PlaywrightSpec {
  title: string;
  tests?: { results?: { duration: number; steps?: PlaywrightStep[] }[] }[];
}

interface PlaywrightSuite {
  title: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightReport {
  suites?: PlaywrightSuite[];
}

/**
 * Per-mark render counters, written by the spec next to its Playwright report.
 * Keys are bare `test.step` titles — the last `>`-separated segment of a row
 * name.
 */
interface CountersFile {
  schemaVersion?: number;
  marks?: Record<string, { frames?: number; drawCalls?: number } | undefined>;
  /**
   * Marks whose `run` returned false — the spec's own record of what bailed.
   * Optional, and additive: a control checkout predating it simply has none,
   * which is why it costs no `schemaVersion` bump.
   */
  bailed?: string[];
}

interface Counters {
  frames: number;
  drawCalls: number;
}

interface Row {
  name: string;
  ctrlMs: number;
  expMs: number;
  indicator: string;
  /** Counters for this mark, present only when BOTH sides reported them. */
  ctrlCounters?: Counters;
  expCounters?: Counters;
}

const args = process.argv.slice(2);
let controlPath: string | undefined,
  experimentPath: string | undefined,
  mdOutputPath: string | undefined;
// Both undefined by default: an absent width is "do not gate", never a width of
// someone else's choosing — see the header.
let threshold: number | undefined;
let framesThreshold: number | undefined; // borrows `threshold` when unset

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--md" && args[i + 1]) {
    mdOutputPath = args[++i];
  } else if (args[i] === "--threshold" && args[i + 1]) {
    const val = Number(args[++i]);
    if (Number.isNaN(val) || val < 0) {
      console.error(
        `Invalid --threshold value: "${args[i]}". Must be a positive number.`,
      );
      process.exit(1);
    }
    threshold = val;
  } else if (args[i] === "--frames-threshold" && args[i + 1]) {
    const val = Number(args[++i]);
    if (Number.isNaN(val) || val < 0) {
      console.error(
        `Invalid --frames-threshold value: "${args[i]}". Must be a positive number.`,
      );
      process.exit(1);
    }
    framesThreshold = val;
  } else if (!controlPath) {
    controlPath = args[i];
  } else if (!experimentPath) {
    experimentPath = args[i];
  }
}

/**
 * How to name this program in a message the reader will retype.
 *
 * The `.sh` wrapper behind the `tracerbench-compare` bin entry passes the name it was
 * invoked as. Absent it, a bench is running this file through the measured
 * repo's `tsx`, and that spelling is the only true one.
 */
const INVOKED_AS =
  process.env.BENCH_INVOKED_AS ??
  "tsx node_modules/@abernier/skills/scripts/tracerbench-compare.ts";

if (!controlPath || !experimentPath) {
  console.error(
    `Usage: ${INVOKED_AS} <control.json> <experiment.json> [--md <output.md>] [--threshold <percent>] [--frames-threshold <percent>]`,
  );
  process.exit(1);
}

/**
 * Extract a flat map of "suite > test" → duration (ms) from a Playwright JSON report.
 *
 * @param report - the parsed Playwright JSON report whose suites/specs/tests are walked recursively
 */
function extractTests(report: PlaywrightReport) {
  const tests = new Map<string, number>();

  function walk(suite: PlaywrightSuite, prefix: string) {
    const fullPrefix = prefix ? `${prefix} > ${suite.title}` : suite.title;

    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const lastResult = test.results?.[test.results.length - 1];
        if (!lastResult) continue;

        // When test.step() is used, report individual step durations
        if (lastResult.steps?.length) {
          for (const step of lastResult.steps) {
            tests.set(`${fullPrefix} > ${step.title}`, step.duration);
          }
        } else {
          tests.set(`${fullPrefix} > ${spec.title}`, lastResult.duration);
        }
      }
    }

    for (const child of suite.suites ?? []) {
      walk(child, fullPrefix);
    }
  }

  for (const suite of report.suites ?? []) {
    walk(suite, "");
  }

  return tests;
}

const control: PlaywrightReport = JSON.parse(readFileSync(controlPath, "utf8"));
const experiment: PlaywrightReport = JSON.parse(
  readFileSync(experimentPath, "utf8"),
);

const controlTests = extractTests(control);
const experimentTests = extractTests(experiment);

// ── Render counters ─────────────────────────────────────────────
// The spec writes `counters.json` beside its report. It is optional: without
// it the comparison is wall-clock only, exactly as it was before counters
// existed.
const KNOWN_COUNTERS_SCHEMA_VERSION = 1;

/**
 * Read the `counters.json` sitting next to a report, if the spec wrote one.
 *
 * @param reportPath - path to the Playwright report; the counters file is looked up in its directory
 */
function readCounters(reportPath: string) {
  const countersPath = join(dirname(reportPath), "counters.json");
  if (!existsSync(countersPath)) return undefined;

  let file: CountersFile;
  try {
    file = JSON.parse(readFileSync(countersPath, "utf8"));
  } catch (err) {
    // An interrupted run leaves a half-written file behind. Comparing on ms
    // alone beats taking the whole comparison down with it.
    console.error(
      `Ignoring unreadable counters at ${countersPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
  const marks = new Map<string, Counters>();
  for (const [mark, counters] of Object.entries(file.marks ?? {})) {
    if (!counters) continue;
    marks.set(mark, {
      frames: counters.frames ?? 0,
      drawCalls: counters.drawCalls ?? 0,
    });
  }
  return {
    schemaVersion: file.schemaVersion ?? 1,
    marks,
    // `undefined` (the field is absent) and `[]` (nothing bailed) mean
    // different things — the first falls back to the floor below, the second
    // is ground truth saying so.
    bailed: file.bailed ? new Set(file.bailed) : undefined,
  };
}

const controlCounters = readCounters(controlPath);
const experimentCounters = readCounters(experimentPath);

// Schema gate — bumping `schemaVersion` in the spec is the agreed signal for
// "these counters are shaped differently from previous ones". Refusing to
// compare across versions prevents silently-wrong diffs after a breaking
// change to the counters layout. `KNOWN_COUNTERS_SCHEMA_VERSION` should bump
// in lockstep with the spec's `schemaVersion` (and this script updated to
// handle the new shape).
if (
  controlCounters &&
  experimentCounters &&
  controlCounters.schemaVersion !== experimentCounters.schemaVersion
) {
  console.error(
    `Refusing to compare counters with different schemaVersion (control=${controlCounters.schemaVersion}, experiment=${experimentCounters.schemaVersion}). Re-run both sides with the same spec.`,
  );
  process.exit(2);
}
for (const side of [controlCounters, experimentCounters]) {
  if (side && side.schemaVersion > KNOWN_COUNTERS_SCHEMA_VERSION) {
    console.error(
      `Counters schemaVersion ${side.schemaVersion} is newer than this script supports (${KNOWN_COUNTERS_SCHEMA_VERSION}). Update @abernier/skills' tracerbench-compare.ts.`,
    );
    process.exit(2);
  }
}

// Short labels for human-readable output (last `>`-separated segment of
// the fully-qualified test name). Hoisted so both console and Markdown
// output can use it.
const shortLabel = (n: string) => {
  const parts = n.split(" > ");
  return parts[parts.length - 1];
};

// ── Step drift detection ───────────────────────────────────────
// When a step appears on only one side, the comparison silently drops
// it (the chart only plots shared steps). That's misleading when an
// entire suffix of the scenario fails early on one side — typically
// after a testid rename on the branch under test, which makes the new
// spec fail on the (still-old) control build. Surface the divergence
// loudly instead of letting a "1-bar histogram" look like a healthy
// comparison.
const onlyInControl: string[] = [];
const onlyInExperiment: string[] = [];
for (const name of controlTests.keys()) {
  if (!experimentTests.has(name)) onlyInControl.push(name);
}
for (const name of experimentTests.keys()) {
  if (!controlTests.has(name)) onlyInExperiment.push(name);
}

/**
 * A step that bailed via its presence guard rather than measuring anything —
 * a new gesture guards on its target and returns immediately on the control
 * branch that predates it. Such a step exists on BOTH sides by name yet
 * compares a real gesture against a no-op, so it is excluded from the gated
 * total and reported as drift until the branch becomes the control.
 *
 * The spec knows exactly which marks bailed and writes them to `counters.json`,
 * so that is what we read. The floor below is the fallback for a side that did
 * not say — an older control, or no counters at all. It is only a guess, and
 * wrong in both directions: a mark can bail on a count guard and still cost
 * far more than the floor, while nothing stops a genuinely cheap mark from
 * tripping it.
 */
const BAIL_FLOOR_MS = 50;

/**
 * Did `mark` bail on this side? `undefined` when the side did not say.
 *
 * @param counters - this side's parsed counters, or undefined when it wrote none
 * @param mark - the bare `test.step` title to look up
 */
function saidBailed(
  counters: { bailed?: Set<string> } | undefined,
  mark: string,
) {
  return counters?.bailed ? counters.bailed.has(mark) : undefined;
}

// ── Build rows ──────────────────────────────────────────────────
const rows: Row[] = [];
/** Shared-name steps where exactly one side bailed (see BAIL_FLOOR_MS). */
const bailedRows: Row[] = [];
for (const [name, ctrlMs] of controlTests) {
  const expMs = experimentTests.get(name);
  if (expMs === undefined) continue;

  const delta = expMs - ctrlMs;
  const pct =
    ctrlMs === 0
      ? delta === 0
        ? "0.0"
        : "∞"
      : ((delta / ctrlMs) * 100).toFixed(1);
  const sign = delta > 0 ? "+" : "";
  const indicator = `${sign}${pct}%`;

  // Counters are keyed by the bare mark name, and only comparable when both
  // sides measured it.
  const mark = shortLabel(name);
  const ctrlCounters = controlCounters?.marks.get(mark);
  const expCounters = experimentCounters?.marks.get(mark);
  const paired =
    ctrlCounters && expCounters ? { ctrlCounters, expCounters } : {};

  const ctrlSaid = saidBailed(controlCounters, mark);
  const expSaid = saidBailed(experimentCounters, mark);
  const bailed =
    ctrlSaid !== undefined && expSaid !== undefined
      ? ctrlSaid !== expSaid
      : ctrlMs < BAIL_FLOOR_MS !== expMs < BAIL_FLOOR_MS &&
        Math.max(ctrlMs, expMs) >= BAIL_FLOOR_MS;
  if (bailed)
    bailedRows.push({ name, ctrlMs, expMs, indicator: "drift", ...paired });
  else rows.push({ name, ctrlMs, expMs, indicator, ...paired });
}

const sharedCount =
  controlTests.size -
  onlyInControl.length -
  bailedRows.length; /* === gated intersection size */
const hasDrift =
  onlyInControl.length > 0 ||
  onlyInExperiment.length > 0 ||
  bailedRows.length > 0;

/** Rows carrying counters on both sides — the ones the frames gate sums. */
const countedRows = rows.filter((r) => r.ctrlCounters && r.expCounters);
const hasCounters = countedRows.length > 0;

/**
 * `+12`, `-3`, `0` — a signed delta with no unit.
 *
 * @param delta - the already-computed difference to sign
 */
const signed = (delta: number) => `${delta > 0 ? "+" : ""}${delta}`;

/**
 * `120 → 132 (+12)`, or `—` when the mark has no counter data.
 *
 * @param ctrl - the control-side counter, or undefined when absent
 * @param exp - the experiment-side counter, or undefined when absent
 */
const counterCell = (ctrl: number | undefined, exp: number | undefined) =>
  ctrl === undefined || exp === undefined
    ? "—"
    : `${ctrl} → ${exp} (${signed(exp - ctrl)})`;

// ── Console output ──────────────────────────────────────────────
// The two counter columns are only drawn when there are counters to put in
// them; without them the mark names get the width back instead.
const COL = hasCounters
  ? { name: 45, ctrl: 12, exp: 12, delta: 9 }
  : { name: 55, ctrl: 14, exp: 14, delta: 10 };
const COUNTER_COL = { frames: 20, draws: 20 };
const RULE_WIDTH =
  COL.name +
  COL.ctrl +
  COL.exp +
  COL.delta +
  (hasCounters ? COUNTER_COL.frames + COUNTER_COL.draws + 2 : 0) +
  3;

console.log("\n📊 TracerBench — mark duration comparison\n");
const header = [
  "Mark".padEnd(COL.name),
  "Control".padStart(COL.ctrl),
  "Experiment".padStart(COL.exp),
  "Delta".padStart(COL.delta),
];
if (hasCounters) {
  header.push(
    "Frames".padStart(COUNTER_COL.frames),
    "Draw calls".padStart(COUNTER_COL.draws),
  );
}
console.log(...header);
console.log("─".repeat(RULE_WIDTH));

for (const row of [...rows, ...bailedRows]) {
  const cells = [
    row.name.slice(0, COL.name).padEnd(COL.name),
    `${row.ctrlMs}ms`.padStart(COL.ctrl),
    `${row.expMs}ms`.padStart(COL.exp),
    row.indicator.padStart(COL.delta),
  ];
  if (hasCounters) {
    cells.push(
      counterCell(row.ctrlCounters?.frames, row.expCounters?.frames).padStart(
        COUNTER_COL.frames,
      ),
      counterCell(
        row.ctrlCounters?.drawCalls,
        row.expCounters?.drawCalls,
      ).padStart(COUNTER_COL.draws),
    );
  }
  console.log(...cells);
}

// ── Totals & threshold check ────────────────────────────────────
// Bailed rows are excluded from both totals: they compare a real gesture
// against a no-op.
const totalCtrl = rows.reduce((s, r) => s + r.ctrlMs, 0);
const totalExp = rows.reduce((s, r) => s + r.expMs, 0);
const totalDelta = totalExp - totalCtrl;
const totalPct = totalCtrl === 0 ? 0 : (totalDelta / totalCtrl) * 100;
const totalIndicator = `${totalDelta > 0 ? "+" : ""}${totalPct.toFixed(1)}%`;
const msGated = threshold !== undefined;
const msExceeded = threshold !== undefined && totalPct > threshold;

const totalCtrlFrames = countedRows.reduce(
  (s, r) => s + (r.ctrlCounters?.frames ?? 0),
  0,
);
const totalExpFrames = countedRows.reduce(
  (s, r) => s + (r.expCounters?.frames ?? 0),
  0,
);
const framesDelta = totalExpFrames - totalCtrlFrames;
const framesPct =
  totalCtrlFrames === 0 ? 0 : (framesDelta / totalCtrlFrames) * 100;
const framesIndicator = `${framesDelta > 0 ? "+" : ""}${framesPct.toFixed(1)}%`;
// Frames borrows the ms width when it declares none of its own — so a repo that
// names one number gates both signals with it. Neither declared, and there is
// nothing to borrow: no frames gate either.
const framesGate = framesThreshold ?? threshold;
const framesGated = hasCounters && framesGate !== undefined;
const framesExceeded =
  hasCounters && framesGate !== undefined && framesPct > framesGate;

const totalCtrlDraws = countedRows.reduce(
  (s, r) => s + (r.ctrlCounters?.drawCalls ?? 0),
  0,
);
const totalExpDraws = countedRows.reduce(
  (s, r) => s + (r.expCounters?.drawCalls ?? 0),
  0,
);

const exceeded = msExceeded || framesExceeded;
/** Is any signal being judged at all? No width declared, nothing is. */
const gated = msGated || framesGated;

// The status line names the total that failed — "over threshold" alone leaves
// the reader guessing which of the two signals moved. With only one signal
// there is nothing to disambiguate, so the ms total reads as prose rather than
// as a unit — lower-cased where the markdown puts it mid-sentence.
const gateWidths: string[] = [];
if (msGated) {
  gateWidths.push(hasCounters ? `+${threshold}% ms` : `+${threshold}%`);
}
if (framesGated) gateWidths.push(`+${framesGate}% frames`);
const gates = `${gateWidths.length > 1 ? "thresholds" : "threshold"} of ${gateWidths.join(
  " / ",
)}`;

const verdictFor = (msTotal: string) => {
  const framesTotal = `frames ${framesIndicator}`;
  const measured = hasCounters ? [msTotal, framesTotal] : [msTotal];

  // No width declared anywhere: report the numbers and say plainly that nothing
  // judged them. "within" would claim a bar was cleared when none was set.
  if (!gated) {
    return `${measured.join(", ")} — measured, not judged: no threshold is configured, so this run neither passes nor fails. Declare \`thresholds.tracerbenchMs\` in \`bench.json\` to gate it.`;
  }

  const failing: string[] = [];
  if (msExceeded) failing.push(msTotal);
  if (framesExceeded) failing.push(framesTotal);
  if (failing.length) {
    return `${failing.join(" and ")} ${failing.length > 1 ? "exceed" : "exceeds"} ${gates}`;
  }

  // One signal can be gated while the other is not — frames declared, ms left
  // open. Only the judged totals are "within"; the rest is measured and no more.
  const judged: string[] = [];
  if (msGated) judged.push(msTotal);
  if (framesGated) judged.push(framesTotal);
  const ungated = measured.filter((total) => !judged.includes(total));
  const verb = judged.length > 1 ? "within" : "is within";
  const within = `${judged.join(", ")} ${verb} ${gates}`;
  return ungated.length ? `${within}; ${ungated.join(", ")} ungated` : within;
};

const verdict = verdictFor(
  hasCounters ? `ms ${totalIndicator}` : `Total regression ${totalIndicator}`,
);

const totalCells = [
  "Total".padEnd(COL.name),
  `${totalCtrl}ms`.padStart(COL.ctrl),
  `${totalExp}ms`.padStart(COL.exp),
  totalIndicator.padStart(COL.delta),
];
if (hasCounters) {
  totalCells.push(
    counterCell(totalCtrlFrames, totalExpFrames).padStart(COUNTER_COL.frames),
    counterCell(totalCtrlDraws, totalExpDraws).padStart(COUNTER_COL.draws),
  );
}
console.log(...totalCells);
console.log("");

// Three states, not two: failed, passed, and never asked to pass — a green tick
// on an ungated run would read as a bar cleared.
console.log(`${exceeded ? "❌" : gated ? "✅" : "📊"} ${verdict}`);

if (hasDrift) {
  console.log("");
  console.log(
    `⚠️  Step drift: ${sharedCount} compared, ${onlyInExperiment.length} only on experiment, ${onlyInControl.length} only on control, ${bailedRows.length} bailed on one side.`,
  );
  if (onlyInExperiment.length) {
    console.log("   Only on experiment (added/renamed on this branch?):");
    for (const n of onlyInExperiment) console.log(`     - ${shortLabel(n)}`);
  }
  if (onlyInControl.length) {
    console.log("   Only on control (removed/renamed on this branch?):");
    for (const n of onlyInControl) console.log(`     - ${shortLabel(n)}`);
  }
  if (bailedRows.length) {
    console.log(
      `   Bailed on one side (presence guard — excluded from the gated total${hasCounters ? "s" : ""}; measures for real once this branch is the control):`,
    );
    for (const r of bailedRows) console.log(`     - ${shortLabel(r.name)}`);
  }
}
console.log("");

// ── Markdown output (for PR comment) ────────────────────────────
if (mdOutputPath) {
  const xLabels = rows.map((r) => `"${shortLabel(r.name)}"`).join(", ");
  const ctrlValues = rows.map((r) => r.ctrlMs).join(", ");
  const expValues = rows.map((r) => r.expMs).join(", ");

  const mdVerdict = verdictFor(
    hasCounters ? `ms ${totalIndicator}` : `total regression ${totalIndicator}`,
  );
  const statusLine = exceeded
    ? `❌ **FAIL** — ${mdVerdict}`
    : gated
      ? `✅ **PASS** — ${mdVerdict}`
      : `📊 **NO GATE** — ${mdVerdict}`;

  const md = [
    "## 📊 TracerBench — mark duration comparison",
    "",
    statusLine,
    "",
  ];

  if (hasCounters) {
    md.push(
      "> `ms` alone moved — the render path got more expensive. `frames` alone moved — the invalidation policy changed. Both — both.",
      "",
    );
  }

  if (hasDrift) {
    md.push(
      `⚠️ **Step drift** — comparing **${sharedCount}** shared step(s); ${onlyInExperiment.length} only on experiment, ${onlyInControl.length} only on control, ${bailedRows.length} bailed on one side. Likely a testid rename or new step on this branch — the diverging steps will be measured once it merges into the control branch.`,
      "",
      "<details>",
      "<summary>Diverging steps</summary>",
      "",
    );
    if (onlyInExperiment.length) {
      md.push(
        `**Only on experiment** (test ran further on this branch — ${onlyInExperiment.length}):`,
        "",
      );
      for (const n of onlyInExperiment) md.push(`- \`${shortLabel(n)}\``);
      md.push("");
    }
    if (onlyInControl.length) {
      md.push(
        `**Only on control** (test ran further on base branch — ${onlyInControl.length}):`,
        "",
      );
      for (const n of onlyInControl) md.push(`- \`${shortLabel(n)}\``);
      md.push("");
    }
    if (bailedRows.length) {
      md.push(
        `**Bailed on one side** (presence guard — excluded from the gated total${hasCounters ? "s" : ""}; ${bailedRows.length}):`,
        "",
      );
      for (const r of bailedRows)
        md.push(
          `- \`${shortLabel(r.name)}\` (control ${r.ctrlMs}ms, experiment ${r.expMs}ms)`,
        );
      md.push("");
    }
    md.push("</details>", "");
  }

  md.push(
    "```mermaid",
    "xychart-beta",
    '  title "Control vs Experiment (ms)"',
    `  x-axis [${xLabels}]`,
    '  y-axis "Duration (ms)"',
    `  bar "Control" [${ctrlValues}]`,
    `  bar "Experiment" [${expValues}]`,
    "```",
    "",
    "<details>",
    "<summary>Raw data</summary>",
    "",
    hasCounters
      ? "| Mark | Control | Experiment | Delta | Frames | Draw calls |"
      : "| Mark | Control | Experiment | Delta |",
    hasCounters
      ? "| --- | ---: | ---: | ---: | ---: | ---: |"
      : "| --- | ---: | ---: | ---: |",
  );

  for (const row of [...rows, ...bailedRows]) {
    const cells = [`${row.ctrlMs}ms`, `${row.expMs}ms`, row.indicator];
    if (hasCounters) {
      cells.push(
        counterCell(row.ctrlCounters?.frames, row.expCounters?.frames),
        counterCell(row.ctrlCounters?.drawCalls, row.expCounters?.drawCalls),
      );
    }
    md.push(`| ${row.name} | ${cells.join(" | ")} |`);
  }

  const totalRow = [
    `**${totalCtrl}ms**`,
    `**${totalExp}ms**`,
    `**${totalIndicator}**`,
  ];
  if (hasCounters) {
    totalRow.push(
      `**${counterCell(totalCtrlFrames, totalExpFrames)}**`,
      `**${counterCell(totalCtrlDraws, totalExpDraws)}**`,
    );
  }
  md.push(`| **Total** | ${totalRow.join(" | ")} |`);

  md.push("", "</details>", "");

  mkdirSync(dirname(mdOutputPath), { recursive: true });
  writeFileSync(mdOutputPath, md.join("\n"), "utf8");
  console.log(`Markdown summary written to ${mdOutputPath}`);
}

// ── Exit with error if threshold exceeded ───────────────────────
// `exceeded` can only be true where a width was declared, so an ungated run
// falls through to 0 however far the totals moved.
if (exceeded) {
  process.exit(1);
}
