/**
 * Render the branch-size report from a `cloc --git --diff --json --by-file`
 * payload on stdin, and classify paths into buckets.
 *
 * Usage — `branchstat.sh` is the entry point; it passes every option, so none of
 * them defaults here:
 *   cloc … | node --experimental-strip-types branchstat.report.mts --render …
 *   printf '%s\n' <path> … | node --experimental-strip-types … --classify
 *
 * `branchstat.sh` owns everything that talks to git and cloc: base resolution,
 * the working-tree snapshot, the exclusion lists, the comment footer. This file
 * owns what happens to the numbers afterwards — which bucket a path falls in,
 * how the files roll up by module, and the two renderings of the result.
 *
 * It splits here because the rollup is a recursive tree walk carrying an
 * accumulator, painted by a ramp keyed to the depth the walk turns out to
 * reach. As a jq program embedded in a single-quoted shell string that cost
 * more than it returned: no linter, no formatter and no type checker can see
 * inside such a string, and an apostrophe anywhere in it — a comment included —
 * silently truncates the program.
 *
 * TypeScript, run without a build step: Node strips the types (≥ 22.6), and
 * `tsx` covers anything older. So every construct here stays erasable — no
 * enums, no namespaces, no parameter properties.
 */

import { readFileSync } from "node:fs";

/** A cloc `--by-file` section: one entry per path, in a diff sub-object. */
interface ClocSection {
  [path: string]: { code?: number; comment?: number } | undefined;
}

/** The three `cloc --diff` sections, plus the totals row it appends. */
interface ClocDiff {
  added?: ClocSection;
  modified?: ClocSection;
  removed?: ClocSection;
  SUM?: {
    added?: { comment?: number; blank?: number };
    modified?: { comment?: number; blank?: number };
    removed?: { comment?: number; blank?: number };
  };
}

type Bucket = "source" | "tests" | "config";

/** One changed file: its counts, and its name split for the module rollup. */
interface FileRow {
  f: string;
  b: Bucket;
  /** Lines added. */
  a: number;
  /** Lines modified. */
  m: number;
  /** Lines removed. */
  r: number;
  /** Net, `a - r`. */
  n: number;
  /** Lines touched, `a + m + r` — how the report ranks. */
  c: number;
  /** The directory the file sits in, trailing slash included, or "". */
  pre: string;
  /** The filename's dot segments, extension dropped. */
  s: string[];
}

/** Counts summed over a set of rows: a module row, or a bucket total. */
interface Totals {
  a: number;
  m: number;
  r: number;
  n: number;
  c: number;
}

/** One level of the rollup: the rows sharing a key, and what they add up to. */
interface Entry extends Totals {
  key: string;
  rows: FileRow[];
}

/** A bucket section of the report: its rows and their total. */
interface Group extends Totals {
  b: Bucket;
  rows: FileRow[];
}

/**
 * A row the rollup decided to emit, before it knows what shade to paint it.
 * `f` is a file, `g` a module header, `x` the "… and n more" elision.
 */
type Node =
  | { t: "f"; row: FileRow; d: number }
  | { t: "g"; e: Entry; d: number }
  | { t: "x"; n: number; d: number };

// Tests and config are split out rather than dropped: both are hand-written and
// both cost maintenance, but neither answers "how much product code did this
// branch add", so each gets its own net.
//
// Tests first, config second — a vitest config or a Storybook decorator exists
// only because we test, so it lands in tests rather than config.
const TESTS_RE = new RegExp(
  [
    String.raw`(\.(test|spec|stories)\.[^/]+$)`,
    String.raw`(^e2e/)|(/__tests__/)|(^\.storybook/)`,
    String.raw`((^|/)(playwright|vitest)[.-][^/]*$)|(^chromatic[.-][^/]*$)`,
  ].join("|"),
);

// Config: declarative knobs, manifests and CI — not logic. Hand-written tooling
// with actual control flow (scripts/*.sh, .claude/hooks/*.sh) stays source.
const CONFIG_RE = new RegExp(
  [
    String.raw`(\.config(\.[^/]+)?\.[cm]?[jt]sx?$)`, // *.config.ts, vite.config.mcp-app.ts
    String.raw`((^|/)(tsconfig[^/]*|package|components|vercel|bench|branchstat)\.json$)`, // manifests and root knobs
    String.raw`((^|/)\.[a-z-]+rc(\.[a-z]+)?$)`, // .prettierrc.json, .eslintrc.json
    String.raw`(^\.(github|husky|vscode)/)|(^\.claude/[^/]*\.json$)`, // CI, hooks wiring, editor, Claude Code's own settings
    String.raw`(\.(ya?ml|toml)$)`, // any YAML/TOML config
    String.raw`((^|/)\.[a-z][a-z.-]*$)`, // dotfiles: .gitignore, .nvmrc, .env.*
  ].join("|"),
);

const bucketOf = (path: string): Bucket =>
  TESTS_RE.test(path) ? "tests" : CONFIG_RE.test(path) ? "config" : "source";

const stdin = readFileSync(0, "utf8");

// --classify exposes the bucketing on its own: it is the only real logic here,
// it drifts silently when a naming convention changes, and it answers "why is
// this file counted as source?" without re-reading the regexes.
if (process.argv.includes("--classify")) {
  const lines = stdin.split("\n").filter((l) => l !== "");
  console.log(lines.map((l) => `${bucketOf(l)} ${l}`).join("\n"));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Options — all resolved by the shell, which owns git and cloc.
// ---------------------------------------------------------------------------

const flags = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith("--")) continue;
  flags.set(arg.slice(2), argv[i + 1] ?? "");
  i += 1;
}
const opt = (name: string) => flags.get(name) ?? "";
// No fallback: `branchstat.sh` always passes these, and a default here would be
// a second source of truth for a number it already owns — silently divergent the
// day one side moves. Missing means the caller is not the shell, which is a bug
// in the caller, so it says so instead of guessing.
const num = (name: string) => {
  const v = Number(flags.get(name));
  if (!Number.isFinite(v)) {
    process.stderr.write(`branchstat.report: --${name} is required\n`);
    process.exit(2);
  }
  return v;
};

const render = opt("render") === "md" ? "md" : "text";
const title = opt("title");
const base = opt("base");
const range = opt("range");
const tip = opt("tip");
const stat = opt("stat");
/** "0" none, "16" bold/dim only, "256" the grey ramp. */
const colour = opt("colour") || "0";
/** Rows kept per level. A terminal caps them; a PR comment does not. */
const limit = num("limit");
/** How deep the rollup may go, and so the most stops the ramp could need. */
const maxdepth = num("maxdepth");

// ---------------------------------------------------------------------------
// Formatting primitives
// ---------------------------------------------------------------------------

// Colour names the bucket, never the sign: a "+" here is a size, not a verdict,
// so green-good / red-bad would assert something the tool cannot know. Padding
// is computed before wrapping, or the escapes skew the width.
const paint = (c: string, s: string) =>
  colour === "0" ? s : `\x1b[${c}m${s}\x1b[0m`;
const hue = (b: Bucket) => ({ source: "32", tests: "36", config: "33" })[b];

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const rpad = (s: string, n: number) =>
  s + " ".repeat(Math.max(0, n - s.length));
const lpad = (s: string, n: number) =>
  " ".repeat(Math.max(0, n - s.length)) + s;

// Long paths keep their tail — the distinctive part is the filename, not the
// directory it sits in.
const elide = (s: string, n: number) =>
  s.length <= n ? s : `…${s.slice(s.length - n + 1)}`;

// ---------------------------------------------------------------------------
// The module rollup
// ---------------------------------------------------------------------------

/**
 * Split a path into the directory it sits in and the filename's dot segments.
 *
 * Dot-scoped naming makes a family of files one module: `Plane.tile.label` is
 * part of `Plane.tile`, itself part of `Plane`. Rolling the rows up that way
 * names the module that took the charge before anyone reads a filename — and a
 * branch whose weight sits in one module is a different branch from one that
 * spreads the same lines over eight.
 *
 * The trailing extension is dropped; a leading dot stays with the name, so
 * `.gitignore` is one segment and not an empty one followed by a suffix.
 *
 * @param path Repo-relative path of the changed file.
 */
function segs(path: string) {
  const parts = path.split("/");
  const dir = parts.slice(0, -1).join("/");
  let s = parts[parts.length - 1].split(".");
  if (s[0] === "") s = [`.${s[1]}`, ...s.slice(2)];
  if (s.length > 1) s = s.slice(0, -1);
  return { pre: dir === "" ? "" : `${dir}/`, s };
}

// A row keyed at level k: the first k+1 dot segments, directory kept. A file
// with fewer segments than that keeps its own full name, which is how Plane.ts
// separates from Plane.tile.ts one level below the module they share.
const keyat = (row: FileRow, k: number) =>
  row.pre + row.s.slice(0, k + 1).join(".");

const totals = (rows: FileRow[]): Totals => ({
  a: rows.reduce((t, x) => t + x.a, 0),
  m: rows.reduce((t, x) => t + x.m, 0),
  r: rows.reduce((t, x) => t + x.r, 0),
  n: rows.reduce((t, x) => t + x.n, 0),
  c: rows.reduce((t, x) => t + x.c, 0),
});

/**
 * Group rows by their key at one level of the rollup. Entries rank like files,
 * by lines touched, ties broken by key so the output is deterministic.
 *
 * @param rows The rows to split.
 * @param k The rollup level: how many dot segments the key consumes.
 */
function entries(rows: FileRow[], k: number): Entry[] {
  const byKey = new Map<string, FileRow[]>();
  for (const row of rows) {
    const key = keyat(row, k);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }
  return [...byKey]
    .map(([key, rs]) => ({ key, rows: rs, ...totals(rs) }))
    .sort((x, y) => y.c - x.c || x.key.localeCompare(y.key));
}

/**
 * How far down a chain of one-child groups the rollup should skip.
 *
 * A level that splits nothing is not a level. `Plane.tile` holding only
 * `Plane.tile.label` printed the same four numbers twice, one indent apart, to
 * say a single thing — so a chain collapses onto its last link and one row
 * names that one.
 *
 * @param rows The rows of the group being descended into.
 * @param k The level the group was keyed at.
 */
function deepest(rows: FileRow[], k: number): number {
  const here = keyat(rows[0], k);
  if (keyat(rows[0], k + 1) === here) return k;
  const next = new Set(rows.map((row) => keyat(row, k + 1)));
  return next.size === 1 ? deepest(rows, k + 1) : k;
}

/**
 * The rollup, one level per dot segment, as deep as the names go. Nothing here
 * knows how many levels there are: `Plane.tile.label.a.b` nests five times, and
 * a flat tree renders as a flat list, because a group holding one row is
 * rendered as that row — a header repeating the row below it is noise.
 *
 * Two things stop the descent. `maxdepth`, which is how long the ramp is: past
 * it a level would have to reuse a shade. And a level that consumed no new
 * segment — files differing only by extension share every key forever, so a
 * group whose key equals its parent has nothing left to split and lists its
 * rows.
 *
 * The walk yields nodes rather than lines, because the shade a level gets
 * depends on how deep the whole report goes — which is only known once every
 * row exists. Painting on the way down would have to assume that number.
 *
 * @param rows The rows to lay out.
 * @param k The rollup level to key them at.
 * @param d Indentation depth, and so the ramp stop, of the rows emitted here.
 * @param parent Key of the enclosing group, or null at the top.
 */
function tree(
  rows: FileRow[],
  k: number,
  d: number,
  parent: string | null,
): Node[] {
  const es = entries(rows, k);
  const out = es.slice(0, limit).flatMap((e) => node(e, k, d, parent));
  if (es.length > limit) out.push({ t: "x", n: es.length - limit, d });
  return out;
}

/**
 * One entry of a rollup level: the row it stands for, the rows it lists, or the
 * header plus everything below it.
 *
 * @param e The entry to lay out.
 * @param k The rollup level it was keyed at.
 * @param d Indentation depth of the rows emitted here.
 * @param parent Key of the enclosing group, or null at the top.
 */
function node(e: Entry, k: number, d: number, parent: string | null): Node[] {
  if (e.rows.length === 1) return [{ t: "f", row: e.rows[0], d }];
  if (e.key === parent || d >= maxdepth) {
    const out: Node[] = e.rows
      .slice(0, limit)
      .map((row) => ({ t: "f" as const, row, d }));
    if (e.rows.length > limit)
      out.push({ t: "x", n: e.rows.length - limit, d });
    return out;
  }
  const kk = deepest(e.rows, k);
  const key = keyat(e.rows[0], kk);
  return [{ t: "g", e: { ...e, key }, d }, ...tree(e.rows, kk + 1, d + 1, key)];
}

// ---------------------------------------------------------------------------
// Painting the rollup
// ---------------------------------------------------------------------------

/** Eighth blocks, U+258F up to U+2588 — a bar reads below one whole column. */
const EIGHTHS = ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
const BAR_COLUMNS = 8;

/**
 * A row's share of its bucket, as a bar.
 *
 * The indent already says where a row sits and the fade says how deep, but
 * neither says how much — that was left to reading four numbers per row and
 * dividing. The bar says it directly, at every level, where the concentration
 * sentence only ever spoke about the heaviest module.
 *
 * The denominator is the bucket total, one for the whole section, so a bar means
 * the same width everywhere in it and a sub-module reads as visibly a fraction
 * of its parent. It measures lines touched, like the ranking: a rectangle has no
 * negative width, so it could not have measured net.
 *
 * Anything non-zero gets at least one eighth. A row that made the report at all
 * should not draw as nothing.
 *
 * @param c The row's lines touched.
 * @param total The bucket's lines touched.
 */
function bar(c: number, total: number) {
  if (total <= 0 || c <= 0) return "";
  const eighths = Math.max(1, Math.round((c / total) * BAR_COLUMNS * 8));
  const rest = eighths % 8;
  return (
    "█".repeat(Math.floor(eighths / 8)) + (rest > 0 ? EIGHTHS[rest - 1] : "")
  );
}

/**
 * One row on the shared column grid, so a total lands directly above the rows
 * it sums. Padding is computed on the bare string, before painting.
 *
 * The bar shares the label's colour rather than taking one of its own: it is the
 * same fact as the numbers to its right, said in width instead of digits, and a
 * second hue would have claimed it was a third thing.
 *
 * @param name Left-hand label: a bucket, a module or a file.
 * @param d Indentation depth.
 * @param t The counts to show.
 * @param share The bar, or "" for a row that is its own reference.
 * @param nameC SGR parameters for the label and its bar.
 * @param numC SGR parameters for the added/modified/removed columns.
 * @param netC SGR parameters for the net column.
 */
function txRow(
  name: string,
  d: number,
  t: Totals,
  share: string,
  nameC: string,
  numC: string,
  netC: string,
) {
  const i = "  ".repeat(d + 1);
  return (
    paint(nameC, rpad(i + elide(name, 34 - i.length), 36) + rpad(share, 9)) +
    paint(numC, lpad(`+${t.a}`, 8) + lpad(`~${t.m}`, 8) + lpad(`-${t.r}`, 8)) +
    paint(netC, lpad(sign(t.n), 9))
  );
}

/**
 * The SGR parameters a row at depth `d` takes.
 *
 * Weight follows depth, never kind. Every row at a group's first level is a
 * term of that group's total, whether it is a module of six files or a file
 * standing alone — so they have to look alike. Bolding the modules only made
 * "add up the bold ones" come to 27 where the total above said 44.
 *
 * It fades as the rollup goes down, and the fade has to be brightness, not
 * thickness: bold and plain are the same white, so a sub-module read as level
 * with the module above it.
 *
 * The ramp is one stop per level, spread over the depth this diff actually
 * reaches — clamped to `maxdepth`, the descent cap and so the most stops it
 * could ever need. A report going two levels deep gets the two ends of the ramp
 * rather than its first two shades, which is the whole contrast available
 * instead of a fraction of it.
 *
 * It runs 255 down to 247 of the 232-255 greyscale block, and stops there
 * rather than at the bottom because terminals commonly enforce a minimum
 * contrast against the background: measured here, 247 through 235 all render as
 * one grey. A ramp reaching past that floor spends its stops on shades the
 * reader cannot tell apart, which is worse than a shorter ramp — it looks like
 * the levels are not distinguished at all.
 *
 * 256 colours are what any of this needs. The base attributes distinguish two
 * steps, so 8 and 16 get bold then dim for everything below. Light to dark
 * assumes a dark terminal; NO_COLOR is the way out of that assumption.
 *
 * @param d The row's depth.
 * @param span The deepest level the whole report reaches.
 */
function weight(d: number, span: number) {
  const i = Math.min(d, span);
  const n = span < 1 ? 1 : span;
  if (colour !== "256") return i === 0 ? "1" : "2";
  if (i === 0) return "1;38;5;255";
  return `38;5;${255 - Math.round((i * 8) / n)}`;
}

/**
 * Paint one node of the rollup.
 *
 * The whole row takes its level shade, counts included. Holding the counts at
 * one grey flattened the rows: the only thing separating two levels was the
 * left edge of each line, over a band that a contrast floor keeps narrow.
 * Fading the row entire spends that band across its full width.
 *
 * A module row carries no file count — the files are listed directly under it,
 * so it only restated something already on screen.
 *
 * @param node The node to render.
 * @param span The deepest level the whole report reaches.
 * @param total The bucket total the bar is a share of.
 */
function txNode(node: Node, span: number, total: number) {
  if (node.t === "x")
    return paint("2", `${"  ".repeat(node.d + 2)}… and ${node.n} more`);
  const w = weight(node.d, span);
  const [name, t] =
    node.t === "f" ? [node.row.f, node.row] : [node.e.key, node.e];
  return txRow(name, node.d + 1, t, bar(t.c, total), w, w, w);
}

// The bucket row carries no bar: it is the denominator every bar under it is a
// share of, so its own would be a full column on every group, saying nothing.
const txGroup = (g: Group) =>
  txRow(
    `${g.b} · ${g.c} lines touched`,
    0,
    g,
    "",
    hue(g.b),
    "2",
    `1;${hue(g.b)}`,
  );

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

const diff = JSON.parse(stdin) as ClocDiff;
const A = diff.added ?? {};
const M = diff.modified ?? {};
const R = diff.removed ?? {};

/**
 * Sum a cloc section's code lines into the three buckets.
 *
 * @param sec The section to tally, or undefined when cloc omitted it.
 */
function tally(sec: ClocSection | undefined) {
  const t = { source: 0, tests: 0, config: 0 };
  for (const [path, v] of Object.entries(sec ?? {}))
    t[bucketOf(path)] += v?.code ?? 0;
  return t;
}

const tAdded = tally(diff.added);
const tMod = tally(diff.modified);
const tRem = tally(diff.removed);
// cloc classifies every line as code, comment or blank. The bucket rows above
// count code; these two carry the rest, so the summary accounts for the whole
// diff instead of showing a subtotal that reads like a total.
/**
 * The SUM row for one line class, across the three diff sections.
 *
 * @param k The cloc line class to read.
 */
function lineClass(k: "comment" | "blank") {
  return {
    a: diff.SUM?.added?.[k] ?? 0,
    m: diff.SUM?.modified?.[k] ?? 0,
    r: diff.SUM?.removed?.[k] ?? 0,
  };
}

const comments = lineClass("comment");
const blanks = lineClass("blank");

// Weight is lines touched, not net. The report asks who carries the work, and a
// rewrite that removes as much as it adds is work — ranking by net would file a
// 300-line deletion below six one-line additions.
const paths = [
  ...new Set([...Object.keys(A), ...Object.keys(M), ...Object.keys(R)]),
];
const files = paths
  .map((f) => {
    const a = A[f]?.code ?? 0;
    const m = M[f]?.code ?? 0;
    const r = R[f]?.code ?? 0;
    return { f, b: bucketOf(f), a, m, r, n: a - r, c: a + m + r, ...segs(f) };
  })
  .filter((row) => row.c > 0)
  .sort((x, y) => y.c - x.c || x.f.localeCompare(y.f));

// Grouped by bucket, source first: whether a branch grew by product code or by
// test code is the first thing a reader wants, and interleaving the two by size
// makes them read that off a mixed list.
const groups = (["source", "tests", "config"] as const)
  .map((b) => {
    const rows = files.filter((row) => row.b === b);
    return { b, rows, ...totals(rows) };
  })
  .filter((g) => g.rows.length > 0);

// ---------------------------------------------------------------------------
// The concentration sentence
// ---------------------------------------------------------------------------

/**
 * A flat list of every file answers "who carries what" by drowning it. The
 * module rollup answers it; this answers it in one sentence, so the full rollup
 * can stay folded away.
 *
 * It is measured on source: that is the bucket the reader is weighing. With
 * none, the whole diff is scaffolding and the count says so. The denominator is
 * source lines touched — always positive, so the percentage means the same
 * thing on a branch that mostly deletes.
 */
function concentration() {
  const src = files.filter((row) => row.b === "source");
  if (src.length === 0) return `${files.length} files, none of them source`;
  const churn = src.reduce((t, row) => t + row.c, 0);
  const mods = entries(src, 0);
  const share = (n: number) => (churn > 0 ? Math.round((100 * n) / churn) : 0);
  const modshare = share(mods[0]?.c ?? 0);
  // A module of one file is named by that file: the rollup has nothing to add
  // over the row it stands for, and the extension is information.
  const heaviest = mods[0].rows.length === 1 ? mods[0].rows[0].f : mods[0].key;
  if (mods.length > 1 && modshare >= 40)
    return `${heaviest} carries ${modshare}% of the ${churn} source lines touched`;
  if (src.length <= 3)
    return `${src.length} source file${src.length === 1 ? "" : "s"} of ${files.length} touched`;
  const fileshare = share(src.slice(0, 3).reduce((t, row) => t + row.c, 0));
  return `${churn} source lines touched across ${mods.length} modules — the 3 heaviest files carry ${fileshare}%`;
}

// ---------------------------------------------------------------------------
// The two halves of the report, built once
// ---------------------------------------------------------------------------

// The bucket totals answer "how big", the rollup answers "where". Each block is
// aligned within itself, so a column reads straight down it — but the two grids
// are not shared and the numbers do not line up across them: a rollup row spends
// its first 45 columns on a name and a share bar, which the summary has neither
// of. Widening the summary to match would have indented it under nothing.
const head = `  ${rpad("", 10)}${lpad("added", 10)}${lpad("modified", 10)}${lpad("removed", 10)}${lpad("net", 11)}`;
const summary = [
  paint("2", head),
  ...(["source", "tests", "config"] as const).map((b) => {
    const h = hue(b);
    const [a, m, r] = [tAdded[b], tMod[b], tRem[b]];
    return (
      paint(h, `  ${rpad(b, 10)}`) +
      paint("2", lpad(`+${a}`, 10) + lpad(`~${m}`, 10) + lpad(`-${r}`, 10)) +
      paint(`1;${h}`, lpad(sign(a - r), 11))
    );
  }),
  ...(
    [
      ["comments", comments],
      ["blanks", blanks],
    ] as const
  ).map(([label, c]) =>
    paint(
      "2",
      `  ${rpad(label, 10)}${lpad(`+${c.a}`, 10)}${lpad(`~${c.m}`, 10)}${lpad(`-${c.r}`, 10)}`,
    ),
  ),
];

const sections = groups.map((g) => ({ g, ns: tree(g.rows, 0, 0, null) }));
// The ramp spans the depth actually reached, across every bucket, so one shade
// means one level everywhere in the report.
const span = Math.max(0, ...sections.flatMap((s) => s.ns.map((n) => n.d)));
// A blank line ahead of every group: it separates the buckets from each other
// and, on the first one, lifts the whole section off the sentence above it.
const detail = sections.flatMap(({ g, ns }) => [
  "",
  txGroup(g),
  ...ns.map((n) => txNode(n, span, g.c)),
]);

// Markdown is that same block, fenced. A table bought one thing a fence cannot
// hold — a link from each file to its diff anchor — and cost a second renderer,
// a depth capped at two levels because a table cell has no indentation, and a
// layout free to drift from the terminal one. The link never rendered: it needs
// a PR URL, and nothing posts this comment yet.
const perModule =
  groups.length === 0
    ? ["_cloc recognised none of the changed files — no per-module breakdown._"]
    : [
        `<details><summary>Per module — ${concentration()}</summary>`,
        "",
        "```text",
        ...detail.slice(1),
        "```",
        "",
        "</details>",
      ];

const out =
  render === "md"
    ? [
        title,
        "",
        `**${sign(tAdded.source - tRem.source)} net lines of source** · tests ${sign(tAdded.tests - tRem.tests)} · config ${sign(tAdded.config - tRem.config)}`,
        "",
        `\`${base}\` → \`${tip}\` · ${stat}`,
        "",
        "```text",
        ...summary,
        "```",
        "",
        ...perModule,
        "",
        '<sub>The total above is the whole diff, as GitHub counts it. The breakdown below it excludes lockfiles, prose, generated code and assets, and counts code lines only — so it is smaller, and deliberately. Tests and config are counted but bucketed apart, so the source net answers "how much product code did this branch add".</sub>',
      ]
    : [
        `vs ${base} (${range})`,
        paint("2", ` ${stat}`),
        "",
        ...summary,
        "",
        paint("2", `  ${concentration()}`),
        ...detail,
      ];

console.log(out.join("\n"));
