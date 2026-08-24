#!/usr/bin/env tsx
/**
 * Compare two profiler reports (control vs experiment) produced by
 * `e2e/profiler.spec.ts` and report re-render regressions.
 *
 * Two signals — only the per-component one gates the PR:
 *
 * 1. **Per-component fiber renders** (`byComponent`, the gate) — captured by
 *    the bippy recorder injected at runtime. For each component we have a
 *    cause distribution (mount / props / state / context / parent) and a
 *    histogram of changed prop names. This is the automated equivalent of
 *    React DevTools' "Why did this render?". A component above
 *    `--component-threshold` (default ±30%) with at least
 *    `--component-min-renders` renders on both sides fails the PR. Only
 *    codebase components count (Radix, shadcn primitives, third-party libs
 *    are filtered — see `isCodebaseComponent`).
 *
 * 2. **Zone commit counts** (`byId`, advisory) — coarse `<React.Profiler>`
 *    zones (`root` and whatever else the app wraps). Reported but never
 *    blocking — too coarse
 *    to gate on directly. Useful as a "death by 1000 cuts" canary: a zone
 *    regression with no individual component above the gate suggests
 *    cumulative drift across many small components.
 *
 * Usage:
 *   tsx scripts/profiler.compare.ts <control.json> <experiment.json> \
 *     [--md <output.md>] [--threshold <percent>] [--min-commits <n>] \
 *     [--component-threshold <percent>] [--component-min-renders <n>] \
 *     [--include-external] [--soft]
 *
 * Flags:
 *   --md                       Write a Markdown summary (sticky PR comment).
 *   --threshold                Advisory zone threshold + minimum component
 *                              regression threshold. Default 15 (= ±15%).
 *   --min-commits              Floor for advisory zone gate. Default 5.
 *   --component-threshold      Blocking component regression threshold.
 *                              Default 30 (= ±30%).
 *   --component-min-renders    Per-component render-volume floor for the
 *                              blocking gate. Default 20 (both sides must
 *                              clear it).
 *   --include-external         Surface non-codebase components (Radix etc.)
 *                              in the actionable sections. Off by default.
 *   --soft                     Always exit 0 (calibration mode).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types — must match the report shape written by e2e/profiler.spec.ts
// ---------------------------------------------------------------------------

type IdStats = {
  mount: { count: number; actualMs: number; baseMs: number };
  update: { count: number; actualMs: number; baseMs: number };
};

type SourceLoc = {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
};

type ComponentStats = {
  renders: number;
  selfTimeMs: number;
  baseTimeMs: number;
  causes: {
    mount: number;
    props: number;
    state: number;
    context: number;
    parent: number;
    force: number;
  };
  changedProps: Record<string, number>;
  changedContexts: Record<string, number>;
};

type StepStats = {
  step: string;
  durationMs: number;
  totalCommits: number;
  byId: Record<string, IdStats>;
  scanCommits?: number;
  byComponent?: Record<string, ComponentStats>;
};

type Report = {
  generatedAt: string;
  url: string;
  userAgent?: string;
  schemaVersion?: number;
  steps: StepStats[];
};

type ZoneRow = {
  step: string;
  id: string;
  control: number;
  experiment: number;
  delta: number;
  pct: number;
  indicator: string;
  status:
    | "ok"
    | "regression"
    | "improvement"
    | "below-floor"
    | "new"
    | "missing";
};

type CompRow = {
  step: string;
  component: string;
  control: number;
  experiment: number;
  delta: number;
  /** Raw % delta — `(exp - ctrl) / ctrl`. Sensitive to event-capture variance. */
  pct: number;
  indicator: string;
  /**
   * % delta normalised by React commits per step (`renders / scanCommits`).
   * Strips out the noise from event-driven steps where the scenario captured
   * a different number of wheel/drag events between runs — what matters is
   * "how many times does the component render per commit", which is stable.
   * **This is the field that drives the regression status.**
   */
  normPct: number;
  normIndicator: string;
  /** `experiment.renders / experiment.scanCommits`. Used in the hot-spot tagline. */
  perCommit: number;
  status: "ok" | "regression" | "improvement" | "below-floor" | "new";
  /**
   * Subset of regressions that also clear the stricter blocking gate
   * (`componentThreshold` + `componentMinRenders`) AND live in the codebase.
   * **Sole driver of the PR gate** — zones never block, only components do.
   */
  blocker: boolean;
  /** Top causes responsible for the experiment-side renders. */
  topCauses: Array<{ kind: keyof ComponentStats["causes"]; count: number }>;
  /**
   * Changed-prop deltas (experiment count − control count). Sorted by delta
   * descending. Only positive deltas get surfaced — those are the props that
   * started changing more often (or for the first time) on the experiment.
   */
  changedPropDeltas: Array<{
    name: string;
    ctrl: number;
    exp: number;
    delta: number;
  }>;
};

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let controlPath: string | undefined;
let experimentPath: string | undefined;
let mdOutputPath: string | undefined;
let threshold = 15;
let componentThreshold = 30; // ±30% — looser than zone gate, smaller counts are noisier
let componentMinRenders = 20; // gate components with meaningful render volume only
let minCommits = 5;
let soft = false;
/**
 * When `false` (the default) the actionable sections of the comment — TL;DR
 * hot-spot, top regressions, blocker counts — only consider components that
 * `lookupSource()` resolves to a file under one of the source roots.
 * Framework components (Radix primitives, React internals, third-party libs)
 * are surfaced only in the collapsed detail tables, where they're useful
 * context for "*why* is the tree re-rendering" without polluting "*what should
 * I fix*".
 *
 * Pass `--include-external` to opt back in (e.g. when investigating a
 * library-side perf bug). Note: components that *do* live in a source root but
 * happen not to match a definition pattern (rare — typically dynamic
 * displayName) get treated as external and filtered. Acceptable trade-off:
 * far better to under-include than to drown the comment in Radix renders.
 */
let includeExternal = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--md" && args[i + 1]) {
    mdOutputPath = args[++i];
  } else if (a === "--threshold" && args[i + 1]) {
    const v = Number(args[++i]);
    if (!Number.isFinite(v) || v < 0) {
      console.error(`Invalid --threshold: ${args[i]}`);
      process.exit(2);
    }
    threshold = v;
  } else if (a === "--component-threshold" && args[i + 1]) {
    const v = Number(args[++i]);
    if (!Number.isFinite(v) || v < 0) {
      console.error(`Invalid --component-threshold: ${args[i]}`);
      process.exit(2);
    }
    componentThreshold = v;
  } else if (a === "--component-min-renders" && args[i + 1]) {
    const v = Number(args[++i]);
    if (!Number.isFinite(v) || v < 0) {
      console.error(`Invalid --component-min-renders: ${args[i]}`);
      process.exit(2);
    }
    componentMinRenders = v;
  } else if (a === "--min-commits" && args[i + 1]) {
    const v = Number(args[++i]);
    if (!Number.isFinite(v) || v < 0) {
      console.error(`Invalid --min-commits: ${args[i]}`);
      process.exit(2);
    }
    minCommits = v;
  } else if (a === "--soft") {
    soft = true;
  } else if (a === "--include-external") {
    includeExternal = true;
  } else if (!controlPath) {
    controlPath = a;
  } else if (!experimentPath) {
    experimentPath = a;
  }
}

/**
 * How to name this program in a message the reader will retype.
 *
 * The `.sh` wrapper behind the `profiler-compare` bin entry passes that bin
 * name. Absent it, a bench is running this file through the measured repo's
 * `tsx`, and that spelling is the only true one.
 */
const INVOKED_AS =
  process.env.BENCH_INVOKED_AS ??
  "tsx node_modules/@abernier/skills/scripts/profiler.compare.ts";

if (!controlPath || !experimentPath) {
  console.error(
    `Usage: ${INVOKED_AS} <control.json> <experiment.json> \\\n` +
      "  [--md <output.md>] [--threshold <percent>] [--min-commits <n>]\\\n" +
      "  [--component-threshold <percent>] [--component-min-renders <n>] [--soft]",
  );
  process.exit(2);
}

const control: Report = JSON.parse(fs.readFileSync(controlPath, "utf8"));
const experiment: Report = JSON.parse(fs.readFileSync(experimentPath, "utf8"));

// Schema gate — bumping `schemaVersion` in the spec is the agreed signal for
// "this report is shaped differently from previous ones". Refusing to compare
// across versions prevents silently-wrong diffs after a breaking change to
// the report layout. `KNOWN_SCHEMA_VERSION` should bump in lockstep with the
// spec's `schemaVersion` (and this script updated to handle the new shape).
const KNOWN_SCHEMA_VERSION = 2;
const cv = control.schemaVersion ?? 1;
const ev = experiment.schemaVersion ?? 1;
if (cv !== ev) {
  console.error(
    `Refusing to compare reports with different schemaVersion (control=${cv}, experiment=${ev}). Re-run both sides with the same spec.`,
  );
  process.exit(2);
}
if (ev > KNOWN_SCHEMA_VERSION) {
  console.error(
    `Report schemaVersion ${ev} is newer than this script supports (${KNOWN_SCHEMA_VERSION}). Update @abernier/skills' profiler.compare.ts.`,
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Codebase filtering helpers
// ---------------------------------------------------------------------------
//
// Used to decide which components are "actionable" in the PR comment — i.e.
// live under one of this repo's source roots (excluding the shadcn primitives
// it vendors). External components (Radix, React internals, third-party libs)
// are computed but filtered out of the actionable sections (TL;DR, top
// regressions, blocker count).

/**
 * The repository being measured — not the one this script is installed in. The
 * harness ships in the consumer's `node_modules`, so its own location says
 * nothing about the tree whose components it filters; the bench shells run it
 * from the repo root, and git answers from there.
 */
const REPO_ROOT = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return process.cwd();
  }
})();

/**
 * Per-repo values, from `bench.json` at the measured repo's root — the same
 * file the bench shells read. Absent, or absent a key, means the defaults
 * below: one `src`, shadcn vendored under it. A file that exists but does not
 * parse is an error, not a default.
 */
const benchConfig: { sourceRoots?: string[]; shadcnUiRoot?: string } = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "bench.json"), "utf8"),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
})();

/**
 * The source roots, repo-relative and in search order. A single-package repo
 * has exactly one; a workspace names one per package holding components, and
 * they all go into the single grep invocation below.
 */
const SOURCE_ROOTS = benchConfig.sourceRoots ?? ["src"];

/**
 * Shadcn primitives are vendored here by its CLI. The repo's rule is to stay
 * stock with shadcn and never hand-edit what it vendors, so a render
 * regression inside one of these is not actionable.
 */
const SHADCN_UI_ROOT = benchConfig.shadcnUiRoot ?? "src/components/ui/";

const sourceCache = new Map<string, SourceLoc | null>();

/**
 * Find a component's definition in the source roots via fast grep. Cached so
 * each name is grepped at most once per run. Returns null on no/ambiguous
 * match.
 *
 * @param componentName - the React component name to locate (must be PascalCase; generic names are skipped)
 */
function lookupSource(componentName: string): SourceLoc | null {
  if (sourceCache.has(componentName)) return sourceCache.get(componentName)!;
  // Match common definition shapes; bail on generic names that would match
  // too liberally. Anchored on `\b` to avoid `useFooBar` matching `Foo`.
  if (!/^[A-Z][A-Za-z0-9_]{1,}$/.test(componentName)) {
    sourceCache.set(componentName, null);
    return null;
  }
  const patterns = [
    `function ${componentName}\\b`,
    `const ${componentName}\\s*=`,
    `class ${componentName}\\b`,
  ];
  const re = new RegExp(patterns.join("|"));
  try {
    const out = execFileSync(
      "grep",
      [
        "-rEnH",
        "--include=*.ts",
        "--include=*.tsx",
        re.source,
        ...SOURCE_ROOTS.map((root) => path.resolve(REPO_ROOT, root)),
      ],
      { encoding: "utf8" },
    );
    // Pick the first hit deterministically; prefer files whose basename
    // matches the component name (e.g. `Button.tsx` for `Button`).
    const hits = out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const m = /^(.+?):(\d+):/.exec(line);
        if (!m) return null;
        return { file: m[1], line: Number(m[2]) };
      })
      .filter((h): h is { file: string; line: number } => h !== null);
    if (hits.length === 0) {
      sourceCache.set(componentName, null);
      return null;
    }
    const basenameMatch = hits.find(
      (h) => path.basename(h.file).replace(/\.tsx?$/, "") === componentName,
    );
    const pick = basenameMatch ?? hits[0];
    const loc: SourceLoc = {
      fileName: path.relative(REPO_ROOT, pick.file),
      lineNumber: pick.line,
    };
    sourceCache.set(componentName, loc);
    return loc;
  } catch {
    // grep returns 1 when no match — that's expected.
    sourceCache.set(componentName, null);
    return null;
  }
}

/**
 * "Is this a component we can actually act on?" check.
 *
 * Used to filter the marquee sections of the comment (TL;DR, top regressions,
 * blocker count) down to components whose code a reviewer can change. The
 * collapsed detail tables keep everything for "where is the smoke" context.
 *
 * Heuristic:
 *  - **Outside the source roots** → external (Radix, React internals,
 *    third-party libs). Filtered.
 *  - **Inside the vendored shadcn directory** → shadcn primitives, put there by
 *    the shadcn CLI. The repo's rule is to stay stock with shadcn and never
 *    hand-edit what its CLI vendors, so a render regression there is not
 *    actionable. Filtered. The real fix for one of these regressing usually
 *    lives at the call site in the parent component, which would show up
 *    separately.
 *  - **Anywhere else under a source root** → our own code. Kept.
 *
 * Pass `--include-external` to short-circuit and treat everything as actionable
 * (useful when investigating a library-side perf bug).
 *
 * @param name - the component name to classify as actionable user code vs. external/locked-down
 */
function isCodebaseComponent(name: string): boolean {
  if (includeExternal) return true;
  const loc = lookupSource(name);
  if (!loc) return false;
  // Normalise to forward slashes once so the prefix checks are platform-clean.
  const rel = (
    loc.fileName.startsWith("/")
      ? path.relative(REPO_ROOT, loc.fileName)
      : loc.fileName
  )
    .split(path.sep)
    .join("/");
  if (rel.startsWith("..")) return false;
  if (!SOURCE_ROOTS.some((root) => rel.startsWith(`${root}/`))) return false;
  if (rel.startsWith(SHADCN_UI_ROOT)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Diff #1 — zone commit counts (existing signal)
// ---------------------------------------------------------------------------

function sumCommits(s: IdStats | undefined): number {
  if (!s) return 0;
  return s.mount.count + s.update.count;
}

function pctIndicator(
  ctrl: number,
  exp: number,
): { pct: number; indicator: string } {
  if (ctrl === 0 && exp === 0) return { pct: 0, indicator: "0.0%" };
  if (ctrl === 0) return { pct: Number.POSITIVE_INFINITY, indicator: "∞" };
  const pct = ((exp - ctrl) / ctrl) * 100;
  const sign = pct > 0 ? "+" : "";
  return { pct, indicator: `${sign}${pct.toFixed(1)}%` };
}

const zoneRows: ZoneRow[] = [];
let zoneRegressions = 0;

for (const eStep of experiment.steps) {
  const cStep = control.steps.find((s) => s.step === eStep.step);
  if (!cStep) {
    zoneRows.push({
      step: eStep.step,
      id: "(new step)",
      control: 0,
      experiment: eStep.totalCommits,
      delta: eStep.totalCommits,
      pct: Number.POSITIVE_INFINITY,
      indicator: "new",
      status: "new",
    });
    continue;
  }
  const ids = new Set([...Object.keys(cStep.byId), ...Object.keys(eStep.byId)]);
  for (const id of ids) {
    const c = sumCommits(cStep.byId[id]);
    const e = sumCommits(eStep.byId[id]);
    const { pct, indicator } = pctIndicator(c, e);
    let status: ZoneRow["status"];
    if (c === 0 && e === 0) status = "ok";
    else if (c < minCommits) status = "below-floor";
    else if (pct > threshold) {
      status = "regression";
      zoneRegressions++;
    } else if (pct < -threshold) status = "improvement";
    else status = "ok";

    zoneRows.push({
      step: eStep.step,
      id,
      control: c,
      experiment: e,
      delta: e - c,
      pct: Number.isFinite(pct) ? pct : 0,
      indicator,
      status,
    });
  }
}

// ---------------------------------------------------------------------------
// Diff #2 — per-component renders + cause analysis
// ---------------------------------------------------------------------------

const compRows: CompRow[] = [];
/** Components flagged with `status === "regression"` regardless of severity. */
let compRegressions = 0;
/**
 * Components that exceed the *blocking* component gate: stricter threshold
 * (`componentThreshold`, default ±30%) AND meaningful render volume
 * (`componentMinRenders`, default 20). These fail the PR alongside zone
 * regressions. The two-tier design keeps the advisory signal verbose without
 * causing flake — only material localised regressions block.
 */
let compBlockers = 0;

for (const eStep of experiment.steps) {
  const cStep = control.steps.find((s) => s.step === eStep.step);
  const eByComp = eStep.byComponent ?? {};
  const cByComp = cStep?.byComponent ?? {};
  const names = new Set([...Object.keys(cByComp), ...Object.keys(eByComp)]);

  // Use bippy's scanCommits as the normalisation denominator: it is the
  // number of *React commits* recorded at the root, independent of how many
  // user events the scenario happened to capture this run. (`totalCommits`
  // double-counts because every <React.Profiler> zone fires `onRender` for
  // each commit — 2 zones means ~2× the React commit count.)
  const ctrlScanCommits = cStep?.scanCommits ?? 0;
  const expScanCommits = eStep.scanCommits ?? 0;

  for (const component of names) {
    const c = cByComp[component];
    const e = eByComp[component];
    const ctrlRenders = c?.renders ?? 0;
    const expRenders = e?.renders ?? 0;
    const { pct, indicator } = pctIndicator(ctrlRenders, expRenders);

    // Normalised delta: renders-per-commit on each side, then % delta.
    // Falls back to raw % when scanCommits is missing (older reports).
    const ctrlPerCmt =
      ctrlScanCommits > 0 ? ctrlRenders / ctrlScanCommits : ctrlRenders;
    const expPerCmt =
      expScanCommits > 0 ? expRenders / expScanCommits : expRenders;
    const { pct: normPct, indicator: normIndicator } = pctIndicator(
      ctrlPerCmt,
      expPerCmt,
    );
    const perCommit = expPerCmt;

    let status: CompRow["status"];
    let blocker = false;
    const isCodebase = isCodebaseComponent(component);
    if (ctrlRenders === 0 && expRenders === 0) status = "ok";
    else if (ctrlRenders === 0) status = "new";
    else if (ctrlRenders < minCommits) status = "below-floor";
    else if (normPct > threshold) {
      status = "regression";
      // Both regression counters apply to codebase components only —
      // external (Radix, third-party) regressions are real but not
      // actionable from the user's PR; surfacing them in counts would
      // confuse the verdict ("1 advisory regression" pointing at nothing
      // they can fix).
      if (isCodebase) {
        compRegressions++;
        // Blocking sub-tier: only count toward PR gate if all three hold:
        //  1. the RAW render count regressed too (above the advisory
        //     threshold) — normalisation adjusts a finding's magnitude, it
        //     must never create one
        //  2. normalised magnitude exceeds the component threshold (default ±30%)
        //  3. render volume on both sides clears the floor (default 20)
        //
        // (1) is what keeps the denominator from manufacturing blockers. When a
        // step gets FASTER its commit count drops, and dividing an unchanged
        // render count by fewer commits yields a phantom regression equal to
        // the improvement — identical for every component in that step, with
        // `Δ raw` at 0.0% on all of them. Observed live: a step whose commits
        // went 9 → 7 flagged every component at +22.2%, and the one that
        // happened to clear the render floor failed the PR. The reverse case is
        // the one normalisation exists for and still works: more commits
        // captured inflates raw counts, and Δ/cmt divides that back out.
        if (
          pct > threshold &&
          normPct > componentThreshold &&
          ctrlRenders >= componentMinRenders &&
          expRenders >= componentMinRenders
        ) {
          compBlockers++;
          blocker = true;
        }
      }
    } else if (normPct < -threshold) status = "improvement";
    else status = "ok";

    // Top causes for the experiment side: which cause kinds dominate?
    const causes = e?.causes ?? {
      mount: 0,
      props: 0,
      state: 0,
      context: 0,
      parent: 0,
      force: 0,
    };
    const topCauses = (
      Object.entries(causes) as Array<[keyof ComponentStats["causes"], number]>
    )
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([kind, count]) => ({ kind, count }));

    // Changed-prop deltas: which props started changing more often?
    const propNames = new Set([
      ...Object.keys(c?.changedProps ?? {}),
      ...Object.keys(e?.changedProps ?? {}),
    ]);
    const changedPropDeltas: CompRow["changedPropDeltas"] = [];
    for (const name of propNames) {
      const ctrl = c?.changedProps[name] ?? 0;
      const exp = e?.changedProps[name] ?? 0;
      const delta = exp - ctrl;
      if (delta > 0) changedPropDeltas.push({ name, ctrl, exp, delta });
    }
    changedPropDeltas.sort((a, b) => b.delta - a.delta);

    compRows.push({
      step: eStep.step,
      component,
      control: ctrlRenders,
      experiment: expRenders,
      delta: expRenders - ctrlRenders,
      pct: Number.isFinite(pct) ? pct : 0,
      indicator,
      normPct: Number.isFinite(normPct) ? normPct : 0,
      normIndicator,
      perCommit,
      status,
      blocker,
      topCauses,
      changedPropDeltas,
    });
  }
}

// ---------------------------------------------------------------------------
// Console output — zone summary table
// ---------------------------------------------------------------------------

console.log(
  `\n📊 Profiler — re-render regression check\n  control:    ${controlPath}` +
    ` (${control.generatedAt})\n  experiment: ${experimentPath} (${experiment.generatedAt})` +
    `\n  threshold:  ±${threshold}%, min-commits: ${minCommits}\n`,
);

const COL = { step: 20, id: 16, ctrl: 10, exp: 10, delta: 10, status: 14 };
console.log(
  "Step".padEnd(COL.step),
  "Id".padEnd(COL.id),
  "Ctrl".padStart(COL.ctrl),
  "Exp".padStart(COL.exp),
  "Delta".padStart(COL.delta),
  "Status".padStart(COL.status),
);
console.log(
  "─".repeat(
    COL.step + COL.id + COL.ctrl + COL.exp + COL.delta + COL.status + 5,
  ),
);
for (const r of zoneRows) {
  console.log(
    r.step.slice(0, COL.step).padEnd(COL.step),
    r.id.slice(0, COL.id).padEnd(COL.id),
    String(r.control).padStart(COL.ctrl),
    String(r.experiment).padStart(COL.exp),
    r.indicator.padStart(COL.delta),
    r.status.padStart(COL.status),
  );
}

// Top component regressions (or growth if no regressions clear the floor).
// Filter to codebase-only by default — Radix/framework regressions trace back
// to user code at the call site, so showing them in the marquee table would
// be a dead end for a reviewer.
const regressionRows = compRows
  .filter((r) => r.status === "regression" && isCodebaseComponent(r.component))
  .sort((a, b) => b.delta - a.delta);
const newRows = compRows
  .filter((r) => r.status === "new" && isCodebaseComponent(r.component))
  .sort((a, b) => b.experiment - a.experiment);

if (regressionRows.length || newRows.length) {
  console.log("");
  console.log("Top component regressions (cause-aware, normalised):");
  const top = [...regressionRows.slice(0, 5), ...newRows.slice(0, 3)];
  for (const r of top) {
    const causeStr = r.topCauses.length
      ? r.topCauses.map((c) => `${c.kind}=${c.count}`).join(" ")
      : "—";
    const tag =
      r.status === "new" ? "NEW" : `${r.normIndicator} (raw ${r.indicator})`;
    console.log(
      `  [${r.step}] ${r.component.padEnd(28)} ${String(r.control).padStart(5)} → ${String(r.experiment).padStart(5)}  ${tag.padEnd(28)} causes: ${causeStr}`,
    );
    if (r.changedPropDeltas.length) {
      const top3 = r.changedPropDeltas.slice(0, 3);
      console.log(
        `      props growth: ${top3.map((p) => `${p.name}(${p.ctrl}→${p.exp})`).join(", ")}`,
      );
    }
  }
}

console.log("");

const failed = compBlockers > 0;
const verdictLine = failed
  ? `❌ FAIL — ${compBlockers} component blocker(s) above ±${componentThreshold}% with ≥${componentMinRenders} renders`
  : `✅ PASS — 0 component blockers`;
console.log(verdictLine);
if (compRegressions > compBlockers) {
  console.log(
    `ℹ️  ${compRegressions - compBlockers} additional component(s) regressed above ±${threshold}% but below blocking gate (advisory)`,
  );
}
if (zoneRegressions > 0) {
  console.log(
    `ℹ️  ${zoneRegressions} zone(s) regressed above ±${threshold}% (advisory — zones are not a gate)`,
  );
}
console.log("");

// ---------------------------------------------------------------------------
// Markdown output (sticky PR comment)
// ---------------------------------------------------------------------------

if (mdOutputPath) {
  const stepNames = experiment.steps.map((s) => s.step);
  const controlTotals = stepNames.map((name) => {
    const cs = control.steps.find((s) => s.step === name);
    return cs ? cs.totalCommits : 0;
  });
  const experimentTotals = stepNames.map(
    (name) => experiment.steps.find((s) => s.step === name)!.totalCommits,
  );

  // ── TL;DR — three-bullet executive summary ──────────────────────────────
  // The single most useful thing a reviewer can read in 5 seconds. Verdict +
  // top hot-spot + (when applicable) the components in cause + noise note.
  // Everything else (chart, tables) is supporting evidence below.
  //
  // Only component blockers fail the PR. Zone regressions are reported as a
  // suffix on the verdict line ("(advisory)") so the reviewer knows the zone
  // signal moved without confusing it with a hard gate.
  const failedMd = compBlockers > 0;
  let verdictBullet: string;
  if (failedMd) {
    verdictBullet = `**Verdict**: ❌ FAIL — ${compBlockers} component blocker(s) above ±${componentThreshold}% (≥${componentMinRenders} renders)`;
  } else {
    verdictBullet = `**Verdict**: ✅ PASS — 0 component blockers`;
  }
  if (zoneRegressions > 0) {
    verdictBullet += ` _(plus ${zoneRegressions} zone regression(s) — advisory, see below)_`;
  }

  // Top hot-spot: the heaviest re-renderer *from our codebase* (Radix /
  // framework components are filtered — see isCodebaseComponent). The
  // framework count is intentionally hidden here because there's nothing
  // a PR reviewer can do about it directly; the actionable answer is which
  // of *our* components is amplifying renders.
  const topHotSpot = compRows
    .filter((r) => r.experiment > 0 && isCodebaseComponent(r.component))
    .sort((a, b) => b.experiment - a.experiment)[0];
  let hotSpotBullet = "";
  if (topHotSpot) {
    const stats = experiment.steps.find((s) => s.step === topHotSpot.step)
      ?.byComponent?.[topHotSpot.component];
    const topProp = stats
      ? Object.entries(stats.changedProps).sort((a, b) => b[1] - a[1])[0]
      : null;
    const causeStr = topProp
      ? `caused by \`${topProp[0]}\` prop changing`
      : topHotSpot.topCauses[0]
        ? `cause: ${topHotSpot.topCauses[0].kind}`
        : "";
    hotSpotBullet = `**Top hot-spot**: \`${topHotSpot.component}\` × **${topHotSpot.experiment}** renders on \`${topHotSpot.step}\` (~${topHotSpot.perCommit.toFixed(1)}/commit)${causeStr ? ` — ${causeStr}` : ""}`;
  }

  // Components in cause — top blockers + advisory regressions, with source
  // links. Codebase-only by default: pointing at a Radix `Tooltip` regression
  // doesn't help, since the user can't change Radix internals. The same
  // re-render volume is attributable upstream in their own component, which
  // is what shows up here.
  let regressionBullet = "";
  const compRegRows = compRows
    .filter(
      (r) => r.status === "regression" && isCodebaseComponent(r.component),
    )
    .sort(
      (a, b) => Number(b.blocker) - Number(a.blocker) || b.normPct - a.normPct,
    );
  if (compRegRows.length > 0) {
    const top3 = compRegRows.slice(0, 3).map((r) => {
      const tag = r.blocker ? "❌" : "⚠️";
      const propHint = r.changedPropDeltas[0]
        ? ` (\`${r.changedPropDeltas[0].name}\` ${r.changedPropDeltas[0].ctrl === 0 ? "NEW" : `+${r.changedPropDeltas[0].delta}`})`
        : "";
      return `${tag} \`${r.component}\` ${r.normIndicator} on \`${r.step}\`${propHint}`;
    });
    const more =
      compRegRows.length > 3 ? ` *(+${compRegRows.length - 3} more)*` : "";
    regressionBullet = `**Components in cause**: ${top3.join(" · ")}${more}`;
  }

  // Noise detection: a step is "noisy" when its captured commit count varies
  // by >30% between runs. On event-driven steps (drag, wheel) the browser
  // sometimes processes fewer events under CI load, which inflates raw
  // deltas without any real change in render behaviour. Per-commit (Δ/cmt)
  // numbers stay stable across that variance.
  type NoisyStep = { step: string; ctrl: number; exp: number; ratio: number };
  const noisySteps: NoisyStep[] = [];
  for (const eStep of experiment.steps) {
    const cStep = control.steps.find((s) => s.step === eStep.step);
    if (!cStep) continue;
    const cCmt = cStep.scanCommits ?? 0;
    const eCmt = eStep.scanCommits ?? 0;
    if (cCmt < 5 || eCmt < 5) continue;
    const ratio = eCmt / cCmt;
    if (ratio < 0.7 || ratio > 1.43) {
      noisySteps.push({ step: eStep.step, ctrl: cCmt, exp: eCmt, ratio });
    }
  }
  let noiseBullet = "";
  if (noisySteps.length > 0) {
    const worst = noisySteps.sort(
      (a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)),
    )[0];
    const dir = worst.exp < worst.ctrl ? "fewer" : "more";
    const pct = Math.abs(((worst.exp - worst.ctrl) / worst.ctrl) * 100).toFixed(
      0,
    );
    noiseBullet = `**Noise note**: ⚠️ \`${worst.step}\` captured **${pct}% ${dir}** React commits this run (${worst.ctrl} → ${worst.exp}). Trust the **Δ/cmt** column over raw counts on event-driven steps.`;
  }

  const tldrBullets = [
    verdictBullet,
    hotSpotBullet,
    regressionBullet,
    noiseBullet,
  ]
    .filter(Boolean)
    .map((b) => `- ${b}`);

  const md: string[] = [
    "## 🧪 Profiler — re-render regression check",
    "",
    "### 🎯 TL;DR",
    "",
    ...tldrBullets,
    "",
    `_**Component-level renders** (bippy, the automated equivalent of React DevTools' "Why did this render?") are the gate: a regression above ±${componentThreshold}% with ≥${componentMinRenders} renders fails the PR — **and only when \`Δ raw\` regressed too** (above ±${threshold}%), so the normalisation can raise a real finding but never invent one. A component whose render count did not move has not regressed, however the denominator moved. **Zone-level commit counts** (\`<React.Profiler>\` zones) are advisory — too coarse to gate on, but useful for catching cumulative drift across many small components. Component deltas are **normalised by React commits/step** (\`Δ/cmt\`) to suppress event-capture variance. Soft mode: ${soft ? "**ON**" : "OFF"}._`,
    "",
    "```mermaid",
    "xychart-beta",
    '  title "Zone commits per step (Control vs Experiment)"',
    `  x-axis [${stepNames.map((s) => `"${s}"`).join(", ")}]`,
    '  y-axis "Commits"',
    `  bar "Control" [${controlTotals.join(", ")}]`,
    `  bar "Experiment" [${experimentTotals.join(", ")}]`,
    "```",
    "",
  ];

  // ── Top regressed / new components — the marquee section ────────────────
  // Δ/cmt is the normalised delta (per React commit). It is what flagged the
  // row as a regression — raw Δ is shown alongside for context but should
  // never be the field you act on for event-driven steps.
  if (regressionRows.length || newRows.length) {
    md.push("### 🎯 Top per-component changes");
    md.push("");
    md.push(
      "| Step | Component | Ctrl | Exp | Δ raw | Δ/cmt | Top causes | Changed props (Δ) |",
    );
    md.push("| --- | --- | ---: | ---: | ---: | ---: | --- | --- |");
    const top = [...regressionRows.slice(0, 5), ...newRows.slice(0, 5)];
    for (const r of top) {
      const causes = r.topCauses.length
        ? r.topCauses.map((c) => `${c.kind} ${c.count}`).join(", ")
        : "—";
      const props =
        r.changedPropDeltas
          .slice(0, 3)
          .map((p) =>
            p.ctrl === 0
              ? `\`${p.name}\` (NEW ×${p.exp})`
              : `\`${p.name}\` (+${p.delta})`,
          )
          .join(", ") || "—";
      const normTag =
        r.status === "new"
          ? "🆕 NEW"
          : r.blocker
            ? `❌ ${r.normIndicator}`
            : `⚠️ ${r.normIndicator}`;
      md.push(
        `| ${r.step} | \`${r.component}\` | ${r.control} | ${r.experiment} | ${r.indicator} | ${normTag} | ${causes} | ${props} |`,
      );
    }
    md.push("");
  } else if (compRows.some((r) => (r.experiment ?? 0) > 0)) {
    md.push("### 🎯 Per-component changes");
    md.push("");
    md.push(
      "_No component-level regressions above the ±" +
        threshold +
        "% normalised threshold._",
    );
    md.push("");
  }

  // ── Zone breakdown (advisory only — never blocks the PR) ────────────────
  md.push("<details>");
  md.push(
    "<summary>Zones breakdown (advisory — per <code>&lt;React.Profiler&gt;</code> zone)</summary>",
  );
  md.push("");
  md.push("| Step | Id | Control | Experiment | Delta | Status |");
  md.push("| --- | --- | ---: | ---: | ---: | :---: |");
  const ZONE_ICONS: Record<ZoneRow["status"], string> = {
    regression: "❌",
    improvement: "🟢",
    "below-floor": "·",
    new: "🆕",
    missing: "❓",
    ok: "✓",
  };
  for (const r of zoneRows) {
    md.push(
      `| ${r.step} | \`${r.id}\` | ${r.control} | ${r.experiment} | ${r.indicator} | ${ZONE_ICONS[r.status]} |`,
    );
  }
  md.push("");
  md.push("</details>");
  md.push("");

  // ── Per-step component tables ───────────────────────────────────────────
  // Shows the top 8 fiber re-renderers per step + their cause distribution.
  // This is what makes the comment a debugging aid, not just a pass/fail.
  md.push("<details>");
  md.push("<summary>Per-component renders (top 8 per step)</summary>");
  md.push("");
  for (const step of experiment.steps) {
    const rows = compRows
      .filter((r) => r.step === step.step)
      .sort((a, b) => b.experiment - a.experiment)
      .slice(0, 8);
    if (rows.length === 0) continue;
    md.push(`#### \`${step.step}\``);
    md.push("");
    md.push(
      "| Component | Ctrl | Exp | Δ raw | Δ/cmt | Mount | Props | State | Ctx | Parent |",
    );
    md.push(
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    const eByComp = step.byComponent ?? {};
    const cStep = control.steps.find((s) => s.step === step.step);
    const cByComp = cStep?.byComponent ?? {};
    for (const r of rows) {
      const ec = eByComp[r.component]?.causes;
      const cc = cByComp[r.component]?.causes;
      const cell = (ek: keyof ComponentStats["causes"]) => {
        const ev = ec?.[ek] ?? 0;
        const cv = cc?.[ek] ?? 0;
        const d = ev - cv;
        if (d === 0 && ev === 0) return "·";
        if (d === 0) return String(ev);
        return `${ev} (${d > 0 ? "+" : ""}${d})`;
      };
      const normTag =
        r.status === "new"
          ? "🆕"
          : r.status === "regression"
            ? r.blocker
              ? `❌ ${r.normIndicator}`
              : `⚠️ ${r.normIndicator}`
            : r.status === "improvement"
              ? `🟢 ${r.normIndicator}`
              : r.normIndicator;
      md.push(
        `| \`${r.component}\` | ${r.control} | ${r.experiment} | ${r.indicator} | ${normTag} | ${cell(
          "mount",
        )} | ${cell("props")} | ${cell("state")} | ${cell("context")} | ${cell("parent")} |`,
      );
    }
    md.push("");
  }
  md.push("</details>");
  md.push("");

  fs.mkdirSync(path.dirname(mdOutputPath), { recursive: true });
  fs.writeFileSync(mdOutputPath, md.join("\n"), "utf8");
  console.log(`Markdown summary written to ${mdOutputPath}`);
}

// ---------------------------------------------------------------------------
// Exit code — only component blockers fail the PR.
//
// Zones are kept as an *advisory* signal (still computed, still rendered in
// the comment) but never block. Rationale: with per-component data we can
// pinpoint exactly *which* component regressed and *why*. Zones are too
// coarse to gate on directly — a real one-component regression often gets
// averaged out at the zone level, and conversely a "death-by-1000-cuts"
// case where every component drifts +5-10% can trip the zone gate without
// any one component being above the per-component blocker threshold. We
// surface that case in the comment but trust the per-component gate to
// catch what's actually fixable.
// ---------------------------------------------------------------------------

if (compBlockers > 0 && !soft) {
  process.exit(1);
}
