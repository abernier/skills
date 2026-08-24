import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

/**
 * End-to-end tests for `scripts/profiler-compare.ts`.
 *
 * The compare script is structured as a CLI with top-level side effects
 * (arg parsing, file reads, console output, exit codes). Rather than
 * refactoring it into a library to test individual helpers, we drive it
 * as a subprocess: each test materialises minimal control + experiment
 * report JSONs, runs `tsx scripts/profiler-compare.ts <ctrl> <exp> ...`,
 * and asserts on the resulting markdown / exit code.
 *
 * Subprocess startup (~500 ms each) keeps the suite slow-ish but the
 * surface we exercise is the real one — verdict logic, codebase filter,
 * normalisation, schema gate, etc. all behave exactly as in CI.
 */

const COMPARE = path.resolve(__dirname, "profiler-compare.ts");

/**
 * The environment with every repo-local git variable removed.
 *
 * Git reads GIT_DIR and friends out of the environment and lets them win over
 * `cwd`, and a git hook exports them — so every git call in this file gets this
 * environment, not the inherited one. Two things go wrong otherwise: a
 * `git init` addresses the repository GIT_DIR names instead of the temp
 * directory it was pointed at, and `rev-parse --show-toplevel` answers with the
 * cwd instead of the repository. `git rev-parse --local-env-vars` is git's own
 * list, so this stays right as git grows new ones.
 *
 * Built first, because the constants below already need it.
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
 * The repository `dir` sits in.
 *
 * Scrubbed, so the answer is the repository and not `dir` itself: with GIT_DIR
 * set, git already knows which repository it is in and `--show-toplevel`
 * degenerates into reporting the cwd.
 */
function repoRootFrom(dir: string) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: dir,
    encoding: "utf8",
    env: gitEnv,
  }).trim();
}

/**
 * The repository this file is running inside.
 *
 * Not `__dirname/..`: that is the package directory, which is this repo when
 * the plugin runs its own suite and `node_modules/@abernier/skills` when a
 * consumer includes the file — and there, the package directory has no
 * `node_modules/.bin/tsx` and no source tree, so every subprocess spawn came
 * back empty and the block at the bottom skipped the very repo it exists to
 * check. `git rev-parse --show-toplevel` lands on the repo either way, which is
 * the same resolution the shell scripts use — through `repoRootFrom`, so a hook
 * that exported GIT_DIR cannot turn it back into `__dirname`.
 */
const CONSUMER = repoRootFrom(__dirname);

/** The `tsx` of the repo being measured — this package ships none. */
const TSX = path.resolve(CONSUMER, "node_modules", ".bin", "tsx");

// ---------------------------------------------------------------------------
// Fixture repo
// ---------------------------------------------------------------------------
//
// `isCodebaseComponent` greps the configured source roots relative to
// `git rev-parse --show-toplevel`, run in the child's cwd. So we can point the
// script at a throwaway repo and control exactly which component resolves
// where. That is the only way to prove the multi-root rule: a real tree rarely
// offers a component that lives under one root and under no other, so a
// second-root hit could not be observed reliably.
//
// Two tests at the bottom run against the repo this suite is in instead, so
// the wiring is pinned to a layout nobody arranged for the occasion.

let fixtureRepo: string;

/** Lay a throwaway git repository down in `dir`. */
function initFixtureRepo(dir: string) {
  execFileSync("git", ["init", "--quiet"], {
    cwd: dir,
    stdio: "ignore",
    env: gitEnv,
  });
}

function writeFixtureFile(rel: string, contents: string) {
  const abs = path.join(fixtureRepo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, "utf8");
}

beforeAll(() => {
  fixtureRepo = fs.mkdtempSync(
    path.join(os.tmpdir(), "profiler-compare-repo-"),
  );
  initFixtureRepo(fixtureRepo);
  // The layout below is a workspace, so the fixture says so — the script reads
  // its roots from `.claude/bench.json` and defaults to a single `src`.
  writeFixtureFile(
    ".claude/bench.json",
    JSON.stringify({
      sourceRoots: ["packages/www/src", "packages/ds/src"],
      shadcnUiRoot: "packages/ds/src/components/ui/",
    }),
  );
  // Root #1 — the app package.
  writeFixtureFile(
    "packages/www/src/app/StageView.tsx",
    "export function StageView() {\n  return null;\n}\n",
  );
  // Root #2 — the design-system package, outside the vendored shadcn folder.
  // A component only ever found here proves the second root is grepped.
  writeFixtureFile(
    "packages/ds/src/Palette.tsx",
    "export function Palette() {\n  return null;\n}\n",
  );
  // Vendored by the shadcn CLI — off-limits, so never actionable.
  writeFixtureFile(
    "packages/ds/src/components/ui/tooltip.tsx",
    "function Tooltip() {\n  return null;\n}\n\nexport { Tooltip };\n",
  );
});

afterAll(() => {
  fs.rmSync(fixtureRepo, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A repo that says nothing
// ---------------------------------------------------------------------------
//
// `.claude/bench.json` is optional, and its defaults are the single-package
// case: one `src`, shadcn vendored under it. That is the shape the other repo
// running this harness has, so it gets a fixture of its own — otherwise every
// test here would exercise the configured path and the default could rot.

let plainRepo: string;

beforeAll(() => {
  plainRepo = fs.mkdtempSync(path.join(os.tmpdir(), "profiler-compare-plain-"));
  initFixtureRepo(plainRepo);
  fs.mkdirSync(path.join(plainRepo, "src", "components", "ui"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(plainRepo, "src", "StageView.tsx"),
    "export function StageView() {\n  return null;\n}\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(plainRepo, "src", "components", "ui", "tooltip.tsx"),
    "function Tooltip() {\n  return null;\n}\n\nexport { Tooltip };\n",
    "utf8",
  );
});

afterAll(() => {
  fs.rmSync(plainRepo, { recursive: true, force: true });
});

describe("repo resolution", () => {
  it("lands on the repository, not the cwd, when a hook has exported GIT_DIR", () => {
    // `CONSUMER` is how a consuming repo gets its own tree measured, and it
    // asks git rather than deriving it from `__dirname` — which under
    // `node_modules` is the package, not the repo. But `--show-toplevel` only
    // *discovers* a repository when git does not already know which one it is
    // in: with GIT_DIR set it answers with the cwd instead. Hooks export
    // GIT_DIR, so a consumer whose gate runs from `.husky/pre-commit` resolved
    // `CONSUMER` to the package directory inside `node_modules/.pnpm/…`, found
    // no `tsx` there, and skipped the block that exists to check its tree.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "profiler-toplevel-"));
    try {
      const host = path.join(scratch, "host");
      fs.mkdirSync(host);
      const git = (...args: string[]) =>
        execFileSync("git", ["-C", host, ...args], {
          stdio: "ignore",
          env: gitEnv,
        });
      git("init", "--quiet");
      git(
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "--allow-empty",
        "--quiet",
        "-m",
        "root",
      );
      // A worktree, so GIT_DIR below is shaped the way a hook running in one
      // sets it — the shape that made this go wrong in the first place.
      git("worktree", "add", "--quiet", path.join(scratch, "wt"), "-b", "wt");

      // Where this file sits once a consumer installs the package.
      const installed = path.join(
        host,
        "node_modules",
        "@abernier",
        "skills",
        "scripts",
      );
      fs.mkdirSync(installed, { recursive: true });

      const saved = process.env.GIT_DIR;
      process.env.GIT_DIR = path.join(host, ".git", "worktrees", "wt");
      let resolved: string;
      try {
        resolved = repoRootFrom(installed);
      } finally {
        if (saved === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = saved;
      }

      expect(resolved).toBe(fs.realpathSync(host));
      expect(resolved).not.toBe(fs.realpathSync(installed));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("fixture repo", () => {
  it("cannot be redirected into the repository GIT_DIR names", () => {
    // The bug this pins. `git init` reads GIT_DIR out of the environment and
    // ignores `cwd` for it. Git hooks export GIT_DIR, and inside a worktree it
    // names `<main>/.git/worktrees/<name>` — an init against *that* writes
    // `core.bare = true` into the MAIN repository's config, and every worktree
    // of it stops working at once. This suite runs from `pnpm lgtm`, which
    // runs from `.husky/pre-commit`, so it did exactly that.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "profiler-gitdir-"));
    try {
      const host = path.join(scratch, "host");
      const target = path.join(scratch, "target");
      fs.mkdirSync(host);
      fs.mkdirSync(target);

      const git = (...args: string[]) =>
        execFileSync("git", ["-C", host, ...args], {
          stdio: "ignore",
          env: gitEnv,
        });
      git("init", "--quiet");
      git(
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "--allow-empty",
        "--quiet",
        "-m",
        "root",
      );
      git("worktree", "add", "--quiet", path.join(scratch, "wt"), "-b", "wt");

      const saved = process.env.GIT_DIR;
      process.env.GIT_DIR = path.join(host, ".git", "worktrees", "wt");
      try {
        initFixtureRepo(target);
      } finally {
        if (saved === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = saved;
      }

      // Nothing landed in the repository GIT_DIR named…
      let bare = "";
      try {
        bare = execFileSync(
          "git",
          ["-C", host, "config", "--get", "core.bare"],
          { encoding: "utf8", env: gitEnv },
        ).trim();
      } catch {
        bare = ""; // `--get` exits 1 when the key is unset, which is the point
      }
      expect(bare).not.toBe("true");
      // …and the repository landed where it was asked for.
      expect(fs.existsSync(path.join(target, ".git"))).toBe(true);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Report fixtures
// ---------------------------------------------------------------------------

type ComponentLike = {
  renders: number;
  causes?: Partial<{
    mount: number;
    props: number;
    state: number;
    context: number;
    parent: number;
    force: number;
  }>;
  changedProps?: Record<string, number>;
};

/**
 * Build a minimal step shape the compare script accepts. Only the fields the
 * compare actually reads are populated; the rest are zero-defaults. Tests
 * never assert on durations so we leave them at 0.
 */
function makeStep(
  step: string,
  zoneCommits: number,
  scanCommits: number,
  byComponent: Record<string, ComponentLike>,
) {
  const fullByComponent: Record<string, unknown> = {};
  for (const [name, c] of Object.entries(byComponent)) {
    fullByComponent[name] = {
      renders: c.renders,
      selfTimeMs: 0,
      baseTimeMs: 0,
      causes: {
        mount: 0,
        props: 0,
        state: 0,
        context: 0,
        parent: 0,
        force: 0,
        ...c.causes,
      },
      changedProps: c.changedProps ?? {},
      changedContexts: {},
    };
  }
  return {
    step,
    durationMs: 0,
    totalCommits: zoneCommits,
    byId: {
      root: {
        mount: { count: 0, actualMs: 0, baseMs: 0 },
        update: { count: zoneCommits, actualMs: 0, baseMs: 0 },
      },
    },
    scanCommits,
    byComponent: fullByComponent,
  };
}

function makeReport(steps: ReturnType<typeof makeStep>[]) {
  return {
    generatedAt: new Date().toISOString(),
    url: "http://localhost/?profile=1",
    schemaVersion: 2,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Subprocess driver
// ---------------------------------------------------------------------------

type Run = {
  exitCode: number;
  stdout: string;
  markdown: string;
};

function runCompare(
  ctrl: ReturnType<typeof makeReport>,
  exp: ReturnType<typeof makeReport>,
  flags: string[],
  tmpDir: string,
  cwd: string,
): Run {
  const ctrlPath = path.join(tmpDir, "control.json");
  const expPath = path.join(tmpDir, "experiment.json");
  const mdPath = path.join(tmpDir, "comment.md");
  fs.writeFileSync(ctrlPath, JSON.stringify(ctrl));
  fs.writeFileSync(expPath, JSON.stringify(exp));

  let stdout = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(
      TSX,
      [COMPARE, ctrlPath, expPath, "--md", mdPath, ...flags],
      { encoding: "utf8", cwd, env: gitEnv },
    );
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    exitCode = err.status ?? 1;
    stdout = err.stdout ?? "";
  }
  const markdown = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, "utf8") : "";
  return { exitCode, stdout, markdown };
}

let testTmpDirs: string[] = [];

beforeEach(() => {
  testTmpDirs = [];
});

afterEach(() => {
  for (const d of testTmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

/**
 * Same as `runCompare` but tracks the temp dir so it gets cleaned up after
 * the test, keeping `/tmp` tidy without leaking fixtures across runs.
 * Resolves components against the fixture repo unless told otherwise.
 */
function run(
  ctrl: ReturnType<typeof makeReport>,
  exp: ReturnType<typeof makeReport>,
  flags: string[] = [],
  cwd: string = fixtureRepo,
): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profiler-compare-test-"));
  testTmpDirs.push(dir);
  return runCompare(ctrl, exp, flags, dir, cwd);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("profiler-compare verdict", () => {
  it("PASSes a clean run with no regressions", () => {
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: { renders: 50, causes: { props: 50 }, changedProps: {} },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: { renders: 50, causes: { props: 50 }, changedProps: {} },
      }),
    ]);

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(0);
    expect(r.markdown).toMatch(/✅ PASS — 0 component blockers/);
  });

  it("FAILs when a component under packages/www/src blocks (>±30% with ≥20 renders)", () => {
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: {
          renders: 30,
          causes: { props: 30 },
          changedProps: { spherical: 30 },
        },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: {
          renders: 100,
          causes: { props: 100 },
          changedProps: { spherical: 100 },
        },
      }),
    ]);

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(1);
    expect(r.markdown).toMatch(/❌ FAIL/);
    expect(r.markdown).toContain("StageView");
  });

  it("FAILs when a component under packages/ds/src blocks — the second source root", () => {
    // `Palette` exists only in `packages/ds/src/`. If the grep covered the app
    // package alone it would come back unresolved, be treated as external, and
    // this would PASS. That is exactly the monorepo bug this test guards.
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        Palette: { renders: 30, causes: { props: 30 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        Palette: { renders: 100, causes: { props: 100 } },
      }),
    ]);

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(1);
    expect(r.markdown).toMatch(/❌ FAIL/);
    expect(r.markdown).toContain("Palette");
  });

  it("does NOT block when the raw render count did not move — the denominator did", () => {
    // The phantom blocker, observed live. The step got FASTER (scanCommits
    // 10 → 7), the component rendered exactly as many times, and dividing an
    // unchanged count by fewer commits invents +42.9% renders/cmt. Every
    // component in the step shows the identical figure with `Δ raw` at 0.0%,
    // and whichever one clears the render floor used to fail the PR.
    const ctrl = makeReport([
      makeStep("device-swap", 20, 10, {
        StageView: { renders: 32, causes: { props: 32 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("device-swap", 14, 7, {
        StageView: { renders: 32, causes: { props: 32 } },
      }),
    ]);

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(0);
    expect(r.markdown).toMatch(/✅ PASS/);
  });

  it("STILL blocks a real regression — the guard must not swallow findings", () => {
    // Same render floor, same component, but the raw count genuinely moved
    // (30 → 60) with the commit count held flat. Nothing about the fix above
    // may soften this.
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: { renders: 30, causes: { props: 30 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: { renders: 60, causes: { props: 60 } },
      }),
    ]);

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(1);
    expect(r.markdown).toMatch(/❌ FAIL/);
  });

  it("still divides out a raw delta the harness caused — normalisation's own job", () => {
    // The case the normalisation exists for, and the mirror of the phantom:
    // the run captured MORE commits (10 → 15) so the component rendered
    // proportionally more (30 → 45). Raw reads +50%, renders/cmt reads 0%.
    // The raw guard is satisfied here, so this proves it is the NORMALISED
    // figure that still decides — the guard adds a condition, it does not
    // replace one.
    const ctrl = makeReport([
      makeStep("scrub", 20, 10, {
        StageView: { renders: 30, causes: { props: 30 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("scrub", 30, 15, {
        StageView: { renders: 45, causes: { props: 45 } },
      }),
    ]);

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(0);
    expect(r.markdown).toMatch(/✅ PASS/);
  });

  it("does NOT block on a regression below the component-min-renders floor", () => {
    // Same component but with control=10 (below default floor 20). Even at
    // +200% renders/cmt this should not trigger the blocking gate.
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: { renders: 10, causes: { props: 10 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: { renders: 30, causes: { props: 30 } },
      }),
    ]);

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(0);
    expect(r.markdown).toMatch(/✅ PASS/);
  });

  it("filters shadcn primitives and external components out of the blocking gate", () => {
    // `Tooltip` resolves to `packages/ds/src/components/ui/tooltip.tsx`, which
    // the shadcn CLI vendors. We stay stock with shadcn, so isCodebaseComponent
    // returns false and the gate does NOT fire even at +300%.
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        Tooltip: { renders: 25, causes: { props: 25 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        Tooltip: { renders: 100, causes: { props: 100 } },
      }),
    ]);

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(0);
    expect(r.markdown).toMatch(/✅ PASS/);
  });

  it("resolves a component under `src` in a repo with no bench.json", () => {
    // No config at all — the single-package default. If the defaults were lost,
    // `StageView` would come back unresolved, be treated as external, and this
    // would PASS instead of blocking.
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: { renders: 30, causes: { props: 30 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: { renders: 100, causes: { props: 100 } },
      }),
    ]);

    const r = run(ctrl, exp, [], plainRepo);
    expect(r.exitCode).toBe(1);
    expect(r.markdown).toMatch(/❌ FAIL/);
    expect(r.markdown).toContain("StageView");
  });

  it("filters `src/components/ui` in a repo with no bench.json", () => {
    // The other half of the default: shadcn vendored directly under `src`.
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        Tooltip: { renders: 25, causes: { props: 25 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        Tooltip: { renders: 100, causes: { props: 100 } },
      }),
    ]);

    const r = run(ctrl, exp, [], plainRepo);
    expect(r.exitCode).toBe(0);
    expect(r.markdown).toMatch(/✅ PASS/);
  });

  it("--include-external promotes external regressions into the gate", () => {
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        Tooltip: { renders: 25, causes: { props: 25 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        Tooltip: { renders: 100, causes: { props: 100 } },
      }),
    ]);

    const r = run(ctrl, exp, ["--include-external"]);
    expect(r.exitCode).toBe(1);
    expect(r.markdown).toContain("Tooltip");
  });

  it("normalises out event-capture noise via Δ/cmt", () => {
    // Identical render-per-commit ratio (StageView: 5 renders / commit) on
    // both sides. Raw counts differ because experiment captured half as many
    // commits — without normalisation this looks like a -50% improvement; with
    // normalisation it's correctly 0.
    const ctrl = makeReport([
      makeStep("scrub", 40, 40, {
        StageView: { renders: 200, causes: { props: 200 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("scrub", 20, 20, {
        StageView: { renders: 100, causes: { props: 100 } },
      }),
    ]);

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(0);
    // Either no regression bullet at all, OR it reports raw/cmt deltas around 0
    expect(r.markdown).toMatch(/✅ PASS/);
    // Raw delta line should still surface in the per-step table — the noise
    // suppression is in the Δ/cmt column, not in the data we collect.
    expect(r.markdown).toContain("-50.0%");
    // The TL;DR should include a noise note pointing at the divergence.
    expect(r.markdown).toMatch(/Noise note/);
  });

  it("--soft forces exit 0 even when a blocker would otherwise fail", () => {
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: { renders: 30, causes: { props: 30 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: { renders: 100, causes: { props: 100 } },
      }),
    ]);

    const r = run(ctrl, exp, ["--soft"]);
    expect(r.exitCode).toBe(0);
    // Verdict still reads FAIL — soft mode mutes the exit code, not the report.
    expect(r.markdown).toMatch(/❌ FAIL/);
  });

  it("zone-only regressions are advisory (no PR fail, but flagged in TL;DR)", () => {
    // Zones doubled, but components inside stay below blocking gate. The
    // verdict is PASS but the TL;DR mentions the advisory zone movement.
    const ctrl = makeReport([
      makeStep("orbit", 10, 5, {
        StageView: { renders: 10, causes: { props: 10 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 30, 5, {
        StageView: { renders: 10, causes: { props: 10 } },
      }),
    ]);

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(0);
    expect(r.markdown).toMatch(/✅ PASS/);
    expect(r.markdown).toMatch(/zone regression\(s\) — advisory/);
  });

  it("rejects reports with mismatched schemaVersion", () => {
    const ctrl = makeReport([]);
    const exp = makeReport([]);
    exp.schemaVersion = 3;

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(2);
  });

  it("surfaces the changed-prop name with the largest growth", () => {
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: {
          renders: 30,
          causes: { props: 30 },
          changedProps: { spherical: 20, target: 10 },
        },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        StageView: {
          renders: 100,
          causes: { props: 100 },
          // spherical blew up while target stayed flat
          changedProps: { spherical: 90, target: 10 },
        },
      }),
    ]);

    const r = run(ctrl, exp);
    expect(r.exitCode).toBe(1);
    expect(r.markdown).toContain("`spherical`");
    // The offending prop count delta should appear next to the row.
    expect(r.markdown).toMatch(/spherical.*\+70/);
  });
});

// ---------------------------------------------------------------------------
// The repo this suite is running in
// ---------------------------------------------------------------------------
//
// The fixture repos above build their own trees, so they prove the rules but
// not the wiring: point `sourceRoots` at a directory that does not exist and
// every one of them still passes. This block is the one that notices — so it
// names no component and no path, and asks the repo for a subject instead.

/**
 * The repo this suite runs in, which is where the script's own `REPO_ROOT`
 * lands too: the child gets `REAL_REPO` as its cwd and resolves the root from
 * there, with the same `git rev-parse --show-toplevel` it uses in a consuming
 * repo — which is exactly how `CONSUMER` was resolved.
 */
const REAL_REPO = CONSUMER;

/** This repo's own bench config, read exactly the way the script reads it. */
const realRepoConfig: { sourceRoots?: string[]; shadcnUiRoot?: string } =
  (() => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(REAL_REPO, ".claude", "bench.json"), "utf8"),
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  })();

/**
 * Whether this repo is one the block below can say anything about.
 *
 * The harness ships as a package now, and that package has no `src` and no
 * application code at all — there is no component in it to gate on, and
 * asserting on the absence of one asserts nothing. But "the declared roots are
 * not there" is *also* the misconfiguration this block exists to catch, so the
 * two are told apart by whether the repo claims a source tree at all:
 *
 *  - `.claude/bench.json` names `sourceRoots` → the repo claims one. Whether
 *    those roots exist, and whether they hold anything first-party, is
 *    `aFirstPartyComponent`'s business — and it throws when they do not.
 *  - No config but a `src/` → the same thing against the built-in default.
 *  - Neither → nothing here claims to be measurable. That is this package
 *    running its own suite, and the block skips, by name and out loud.
 *
 * Only the last case skips. A consuming repo always lands in one of the first
 * two, so the throw still fires everywhere it means anything.
 */
const CLAIMS_A_SOURCE_TREE =
  realRepoConfig.sourceRoots !== undefined ||
  fs.existsSync(path.join(REAL_REPO, "src"));

if (!CLAIMS_A_SOURCE_TREE) {
  console.warn(
    `[profiler-compare] "against the repo it runs in" skipped: ${REAL_REPO} ` +
      `declares no sourceRoots and has no src/, so it holds no component to ` +
      `resolve. The fixture repos above still cover the rules — this block is ` +
      `the one that catches a source tree the config has stopped matching.`,
  );
}

/** Skips only when this repo claims no source tree at all — see above. */
const describeAgainstThisRepo = describe.skipIf(!CLAIMS_A_SOURCE_TREE);

/**
 * A first-party component of whatever repo this is, found the way
 * `lookupSource` would find it: a `.tsx` under one of the declared source
 * roots whose basename is also a name it defines. That is `lookupSource`'s own
 * tie-break, so the lookup lands on this file rather than on some other hit,
 * and the test pins the resolution instead of fighting it.
 *
 * Skips the vendored shadcn directory, which is deliberately not actionable,
 * and skips any name that also has a file there — the grep would be entitled
 * to resolve such a name to the vendored copy.
 *
 * Throws when it finds nothing. A test that quietly skips itself is worse than
 * no test, and finding nothing means the roots are wrong, which is exactly the
 * failure this block exists to catch.
 */
function aFirstPartyComponent(): { name: string; file: string } {
  const roots = realRepoConfig.sourceRoots ?? ["src"];
  const shadcnRoot = realRepoConfig.shadcnUiRoot ?? "src/components/ui/";

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
        `Either .claude/bench.json names roots this repo no longer has, or no ` +
        `.tsx under them defines the component its basename names.`,
    );
  }
  return usable[0];
}

describeAgainstThisRepo("profiler-compare against the repo it runs in", () => {
  it("gates on a component the declared source roots really contain", () => {
    // Nothing here is written down: the subject comes from the roots
    // `.claude/bench.json` declares. Move the source tree without updating the
    // config and there is no subject to find, which throws; point the config
    // at a directory that exists but holds nothing first-party and the gate
    // stops firing. Either way this goes red, and no fixture can tell.
    const subject = aFirstPartyComponent();
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        [subject.name]: { renders: 30, causes: { props: 30 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        [subject.name]: { renders: 100, causes: { props: 100 } },
      }),
    ]);

    const r = run(ctrl, exp, [], REAL_REPO);
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
    const ctrl = makeReport([
      makeStep("orbit", 20, 10, {
        [absent]: { renders: 25, causes: { props: 25 } },
      }),
    ]);
    const exp = makeReport([
      makeStep("orbit", 20, 10, {
        [absent]: { renders: 100, causes: { props: 100 } },
      }),
    ]);

    const r = run(ctrl, exp, [], REAL_REPO);
    expect(r.exitCode).toBe(0);
    expect(r.markdown).toMatch(/✅ PASS/);
  });
});
