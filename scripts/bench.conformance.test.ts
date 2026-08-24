import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULTS, readBenchConfig } from "./bench.config.mjs";

/**
 * The conformance check a consuming repo runs against its own tree.
 *
 * Not a test of this package. `profiler.compare.test.ts` covers the compare
 * script's rules against throwaway fixture repos, and those fixtures build the
 * tree they are then measured against — so they prove the rules but not the
 * wiring. Point `sourceRoots` at a directory that does not exist and every one
 * of them still passes.
 *
 * This file is the one that notices. It names no component and no path: it
 * asks the repo it is running in for a subject, via the same `bench.json` the
 * script reads, and gates on whatever comes back. Move the source tree without
 * updating `bench.json` and there is no subject to find, which throws.
 *
 * `@abernier/skills/bench-tests` points a vitest project at this file inside
 * the consumer's `node_modules`, which is why it ships and why it imports
 * nothing of this package but `bench.config.mjs`: vitest transforms the test
 * file it was handed, and externalises relative imports under `node_modules`
 * to Node, which refuses to strip types there.
 */

const COMPARE = path.resolve(__dirname, "profiler.compare.ts");

/**
 * The environment with every repo-local git variable removed.
 *
 * Git reads GIT_DIR and friends out of the environment and lets them win over
 * `cwd`, and a git hook exports them — so `rev-parse --show-toplevel` would
 * answer with the cwd instead of the repository, and the compare subprocess
 * would resolve components against the hook's repo. `git rev-parse
 * --local-env-vars` is git's own list, so this stays right as git grows new
 * ones.
 */
const gitEnv = { ...process.env };
for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)) {
  delete gitEnv[name];
}

/**
 * The repository this file is running inside — the consumer's, when the
 * consumer runs it.
 *
 * Not `__dirname/..`: that is the package directory, which is this repo when
 * the plugin runs its own suite and `node_modules/@abernier/skills` when a
 * consumer includes the file — and there, the package directory has no
 * `node_modules/.bin/tsx` and no source tree, so every subprocess spawn came
 * back empty and this block skipped the very repo it exists to check.
 * `git rev-parse --show-toplevel` lands on the repo either way, which is the
 * same resolution the shell scripts use — scrubbed, so a hook that exported
 * GIT_DIR cannot turn it back into `__dirname`.
 */
const REAL_REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: __dirname,
  encoding: "utf8",
  env: gitEnv,
}).trim();

/** The `tsx` of the repo being measured — this package ships none. */
const TSX = path.resolve(REAL_REPO, "node_modules", ".bin", "tsx");

/** This repo's own bench config, read through the reader the script uses. */
const realRepoConfig = readBenchConfig(REAL_REPO);

/**
 * Whether this repo is one this file can say anything about.
 *
 * The harness ships as a package, and that package has no `src` and no
 * application code at all — there is no component in it to gate on, and
 * asserting on the absence of one asserts nothing. But "the declared roots are
 * not there" is *also* the misconfiguration this file exists to catch, so the
 * two are told apart by whether the repo claims a source tree at all:
 *
 *  - `bench.json` names `sourceRoots` → the repo claims one. Whether those
 *    roots exist, and whether they hold anything first-party, is
 *    `aFirstPartyComponent`'s business — and it throws when they do not.
 *  - No config but a `src/` → the same thing against the built-in default.
 *  - Neither → nothing here claims to be measurable. That is this package
 *    running its own suite, and the checks skip, by name and out loud.
 *
 * Only the last case skips. A consuming repo always lands in one of the first
 * two, so the throw still fires everywhere it means anything.
 */
const CLAIMS_A_SOURCE_TREE =
  realRepoConfig.sourceRoots.join("\n") !== DEFAULTS.sourceRoots.join("\n") ||
  fs.existsSync(path.join(REAL_REPO, "src"));

if (!CLAIMS_A_SOURCE_TREE) {
  console.warn(
    `[profiler-compare] "against the repo it runs in" skipped: ${REAL_REPO} ` +
      `declares no sourceRoots and has no src/, so it holds no component to ` +
      `resolve. The fixture repos in profiler.compare.test.ts still cover the ` +
      `rules — this file is the one that catches a source tree the config has ` +
      `stopped matching.`,
  );
}

/** Skips only when this repo claims no source tree at all — see above. */
const describeAgainstThisRepo = describe.skipIf(!CLAIMS_A_SOURCE_TREE);

/**
 * A first-party component of whatever repo this is, found the way
 * `lookupSource` would find it: a `.tsx` under one of the declared source
 * roots whose basename is also a name it defines. That is `lookupSource`'s own
 * tie-break, so the lookup lands on this file rather than on some other hit,
 * and the check pins the resolution instead of fighting it.
 *
 * Skips the vendored shadcn directory, which is deliberately not actionable,
 * and skips any name that also has a file there — the grep would be entitled
 * to resolve such a name to the vendored copy.
 *
 * Throws when it finds nothing. A check that quietly skips itself is worse
 * than no check, and finding nothing means the roots are wrong, which is
 * exactly the failure this file exists to catch.
 */
function aFirstPartyComponent(): { name: string; file: string } {
  const roots = realRepoConfig.sourceRoots;
  const shadcnRoot = realRepoConfig.shadcnUiRoot;

  const candidates: { name: string; file: string }[] = [];
  const vendored = new Set<string>();

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(abs);
        continue;
      }
      if (!entry.name.endsWith(".tsx")) continue;
      const name = entry.name.slice(0, -".tsx".length);
      // The same guard the script applies before it greps at all.
      if (!/^[A-Z][A-Za-z0-9_]+$/.test(name)) continue;
      const rel = path.relative(REAL_REPO, abs).split(path.sep).join("/");
      if (rel.startsWith(shadcnRoot)) {
        vendored.add(name);
        continue;
      }
      // The same definition shapes the script greps for.
      const defines = new RegExp(
        `function ${name}\\b|const ${name}\\s*=|class ${name}\\b`,
      );
      if (defines.test(fs.readFileSync(abs, "utf8"))) {
        candidates.push({ name, file: rel });
      }
    }
  };

  for (const root of roots) {
    const abs = path.join(REAL_REPO, root);
    if (fs.existsSync(abs)) walk(abs);
  }

  const usable = candidates
    .filter((c) => !vendored.has(c.name))
    .sort((a, b) => a.file.localeCompare(b.file));

  if (usable.length === 0) {
    throw new Error(
      `No first-party component found under ${roots.join(", ")}. ` +
        `Either bench.json names roots this repo no longer has, or no ` +
        `.tsx under them defines the component its basename names.`,
    );
  }
  return usable[0];
}

/**
 * A one-step report in which `component` rendered `renders` times, every render
 * caused by a prop change. Only the fields the compare script reads are
 * populated; durations stay at 0 because nothing here asserts on them.
 */
function reportWith(component: string, renders: number) {
  return {
    generatedAt: new Date().toISOString(),
    url: "http://localhost/?profile=1",
    schemaVersion: 2,
    steps: [
      {
        step: "orbit",
        durationMs: 0,
        totalCommits: 20,
        byId: {
          root: {
            mount: { count: 0, actualMs: 0, baseMs: 0 },
            update: { count: 20, actualMs: 0, baseMs: 0 },
          },
        },
        scanCommits: 10,
        byComponent: {
          [component]: {
            renders,
            selfTimeMs: 0,
            baseTimeMs: 0,
            causes: {
              mount: 0,
              props: renders,
              state: 0,
              context: 0,
              parent: 0,
              force: 0,
            },
            changedProps: {},
            changedContexts: {},
          },
        },
      },
    ],
  };
}

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

/**
 * Run `profiler-compare` over the two reports, from the repo's own root, and
 * hand back its exit code and the Markdown comment it wrote.
 *
 * A subprocess and not an import: the compare script is a CLI with top-level
 * side effects, and this is the surface a consumer's CI actually runs.
 */
function runCompare(
  control: ReturnType<typeof reportWith>,
  experiment: ReturnType<typeof reportWith>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-conformance-"));
  tmpDirs.push(dir);

  const controlPath = path.join(dir, "control.json");
  const experimentPath = path.join(dir, "experiment.json");
  const mdPath = path.join(dir, "comment.md");
  fs.writeFileSync(controlPath, JSON.stringify(control));
  fs.writeFileSync(experimentPath, JSON.stringify(experiment));

  let exitCode = 0;
  try {
    execFileSync(
      TSX,
      [COMPARE, controlPath, experimentPath, "--md", mdPath],
      { encoding: "utf8", cwd: REAL_REPO, env: gitEnv },
    );
  } catch (e) {
    exitCode = (e as { status?: number }).status ?? 1;
  }
  const markdown = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, "utf8") : "";
  return { exitCode, markdown };
}

describeAgainstThisRepo("profiler-compare against the repo it runs in", () => {
  it("gates on a component the declared source roots really contain", () => {
    // Nothing here is written down: the subject comes from the roots
    // `bench.json` declares. Move the source tree without updating the config
    // and there is no subject to find, which throws; point the config at a
    // directory that exists but holds nothing first-party and the gate stops
    // firing. Either way this goes red, and no fixture can tell.
    const subject = aFirstPartyComponent();

    const r = runCompare(
      reportWith(subject.name, 30),
      reportWith(subject.name, 100),
    );
    expect(
      r.exitCode,
      `expected ${subject.name} (${subject.file}) to be actionable`,
    ).toBe(1);
    expect(r.markdown).toContain(subject.name);
  });

  it("does not gate on a name no source root contains", () => {
    // The other half: resolving nothing means external, and external never
    // gates. Without this, a lookup that resolved everything would pass above.
    const absent = "NoSuchComponentAnywhereInThisRepo";

    const r = runCompare(reportWith(absent, 25), reportWith(absent, 100));
    expect(r.exitCode).toBe(0);
    expect(r.markdown).toMatch(/✅ PASS/);
  });
});
