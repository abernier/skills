#!/usr/bin/env tsx
/**
 * Fold a profiler run's raw commit log into the per-component report
 * `profiler-compare.ts` diffs.
 *
 * Two faces, one file:
 *
 *  - `aggregateCommits()` is the fold itself, exported for its own unit tests.
 *  - Everything below the `CLI` banner is a program `profiler.sh` runs through
 *    the consuming repo's `tsx`, once per side.
 *
 * It is a *program* and not a library on purpose: the package lives in a
 * consumer's `node_modules`, and Node refuses to strip types under
 * `node_modules`. A spec that imported this file died at run time with
 * "Stripping types is currently unsupported for files under node_modules".
 * Launched as a program through `tsx`, it strips anywhere — the same way
 * `profiler-compare.ts` and `tracerbench-compare.ts` are run.
 *
 * Usage:
 *   tsx node_modules/@abernier/skills/scripts/profiler-aggregate.ts \
 *     <commits.json> <report.json>
 *
 * See the CLI banner below for the exact shape the spec has to write.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

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

// ---------------------------------------------------------------------------
// CLI — the contract a consuming `e2e/profiler.spec.ts` has to satisfy
// ---------------------------------------------------------------------------
//
// The spec writes ONE file, its raw commit log, to the absolute path in
// `$PROFILER_COMMITS` (default `profiler-results/commits.json`). It is the
// report envelope `profiler-compare.ts` already reads, except every step
// carries the recorder's raw `commits` instead of a folded `byComponent`:
//
//   {
//     "generatedAt": "2026-08-24T09:12:33.412Z",   // ISO 8601
//     "url": "http://localhost:4301/",
//     "userAgent": "Mozilla/5.0 …",                // optional
//     "schemaVersion": 2,
//     "steps": [
//       {
//         "step": "orbit",                          // mark name
//         "durationMs": 1843,
//         "totalCommits": 12,                       // <React.Profiler> zones
//         "byId": { "root": { "mount": { "count": 1, "actualMs": 8.1,
//                                        "baseMs": 9.4 },
//                             "update": { "count": 11, "actualMs": 22.7,
//                                         "baseMs": 31.2 } } },
//         "scanCommits": 11,                        // optional, see below
//         "commits": [                              // window.__renderScan__.snapshot()
//           { "renders": [
//               { "name": "ZoomPan",
//                 "cause": { "kind": "props", "changed": ["xywh"] },
//                 "selfTime": 0.4, "baseTime": 1.2 }
//           ] }
//         ]
//       }
//     ]
//   }
//
// A `cause` is one of `{"kind":"mount"}`, `{"kind":"state"}`,
// `{"kind":"parent"}`, `{"kind":"force"}`,
// `{"kind":"props","changed":["…"]}`, `{"kind":"context","names":["…"]}`.
//
// Every other key — `diagnostics`, `failures`, anything a repo adds — travels
// through untouched, at both the top level and the step level.
//
// This program reads that file and writes the report: each step's `commits` is
// replaced by `byComponent`, and `scanCommits` is filled in from
// `commits.length` when the spec left it out. Nothing else moves.
//
// It refuses a file it cannot fold — missing, unparseable, no steps, a step
// with no commit log, a malformed render — with a message on stderr and exit
// code 2. An empty aggregate would read as "no regressions", which is the one
// answer a broken bench must never give.

/** Report the CLI cannot fold, on stderr, and stop. Exit 2 = bad input. */
function fail(message: string): never {
  console.error(`profiler-aggregate: ${message}`);
  process.exit(2);
}

const CAUSE_KINDS = [
  "mount",
  "props",
  "state",
  "context",
  "parent",
  "force",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Validate one render record, `where` naming it for the error message. */
function checkRender(value: unknown, where: string): asserts value is RenderRecord {
  if (!isObject(value)) fail(`${where} is not an object`);
  if (typeof value.name !== "string" || value.name === "") {
    fail(`${where} has no component name`);
  }
  const cause = value.cause;
  if (!isObject(cause)) fail(`${where} (${value.name}) has no cause`);
  const kind = cause.kind;
  if (typeof kind !== "string" || !CAUSE_KINDS.includes(kind as RenderCause["kind"])) {
    fail(
      `${where} (${value.name}) has an unknown cause kind ${JSON.stringify(kind)} — ` +
        `expected one of ${CAUSE_KINDS.join(", ")}`,
    );
  }
  if (kind === "props" && !isStringArray(cause.changed)) {
    fail(`${where} (${value.name}) is a props render with no changed[] names`);
  }
  if (kind === "context" && !isStringArray(cause.names)) {
    fail(`${where} (${value.name}) is a context render with no names[]`);
  }
  for (const field of ["selfTime", "baseTime"] as const) {
    if (typeof value[field] !== "number" || !Number.isFinite(value[field])) {
      fail(`${where} (${value.name}) has a non-numeric ${field}`);
    }
  }
}

/** Validate one step's `commits`, `where` naming the step. */
function checkCommits(value: unknown, where: string): asserts value is CommitRecord[] {
  if (!Array.isArray(value)) {
    fail(
      `${where} has no commits[] — the spec must write the recorder's raw ` +
        `commit log, not a folded byComponent`,
    );
  }
  value.forEach((commit, i) => {
    if (!isObject(commit) || !Array.isArray(commit.renders)) {
      fail(`${where} commit #${i} has no renders[]`);
    }
    (commit.renders as unknown[]).forEach((render, j) => {
      checkRender(render, `${where} commit #${i} render #${j}`);
    });
  });
}

/**
 * How to name this program in a message the reader will retype.
 *
 * The `.sh` wrapper behind the `profiler-aggregate` bin entry passes the name
 * it was invoked as. Absent it, `profiler.sh` is folding a side through the
 * measured repo's `tsx`, and that spelling is the only true one.
 */
const INVOKED_AS =
  process.env.BENCH_INVOKED_AS ??
  "tsx node_modules/@abernier/skills/scripts/profiler-aggregate.ts";

function main(argv: string[]): void {
  let inputPath: string | undefined;
  let outputPath: string | undefined;
  for (const a of argv) {
    if (!inputPath) inputPath = a;
    else if (!outputPath) outputPath = a;
  }

  if (!inputPath || !outputPath) {
    console.error(
      `Usage: ${INVOKED_AS} <commits.json> <report.json>`,
    );
    process.exit(2);
  }

  let source: string;
  try {
    source = fs.readFileSync(inputPath, "utf8");
  } catch (err) {
    fail(`cannot read ${inputPath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    fail(`${inputPath} is not valid JSON: ${(err as Error).message}`);
  }

  if (!isObject(parsed)) fail(`${inputPath} is not a JSON object`);
  const steps = parsed.steps;
  if (!Array.isArray(steps)) {
    fail(`${inputPath} has no steps[] — is this a profiler commit log?`);
  }
  if (steps.length === 0) {
    fail(`${inputPath} has an empty steps[] — the spec recorded nothing`);
  }

  const aggregated = steps.map((step, i) => {
    if (!isObject(step)) fail(`${inputPath} step #${i} is not an object`);
    const where =
      typeof step.step === "string" ? `step "${step.step}"` : `step #${i}`;
    const { commits, ...rest } = step;
    checkCommits(commits, where);
    const { byComponent } = aggregateCommits(commits);
    return {
      ...rest,
      // The spec's own count when it kept one — it asserts on it — and the
      // one number it can only be otherwise.
      scanCommits: typeof rest.scanCommits === "number" ? rest.scanCommits : commits.length,
      byComponent,
    };
  });

  const report = { ...parsed, steps: aggregated };
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  const totalRenders = aggregated.reduce(
    (sum, step) =>
      sum +
      Object.values(step.byComponent).reduce((n, c) => n + c.renders, 0),
    0,
  );
  console.log(
    `Aggregated ${aggregated.length} steps, ${totalRenders} fiber renders → ${outputPath}`,
  );
}

/**
 * Whether this file is the program being run, rather than a module something
 * imported — `profiler-aggregate.test.ts` imports `aggregateCommits` from it,
 * and an import must fold nothing.
 *
 * Through `realpath` on both sides: installed by pnpm, the path a caller types
 * goes through `node_modules/@abernier/skills` — a symlink into the store —
 * while `import.meta.url` is already resolved, and comparing the two verbatim
 * says "imported" for the one invocation that matters.
 */
function invokedAsProgram(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return (
      fs.realpathSync(path.resolve(invoked)) ===
      fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (invokedAsProgram()) {
  main(process.argv.slice(2));
}
