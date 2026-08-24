#!/usr/bin/env bash
# bench.e2e.test.sh — both benches, end to end, against a real app in a real
# browser.
#
# What the rest of the suite cannot reach. `profiler.compare.test.ts` and
# friends feed hand-built JSON to the comparers; `bench.common.test.sh` and
# `bench.config.test.sh` drive the shells for argument parsing;
# `profiler.test.sh` composes the whole profiler harness but deliberately
# without a browser — its spec writes a commit log instead of driving an app.
# None of them ever builds a bundle, boots a dev server, instruments React or
# times a click, which is every part a consumer actually exercises. TracerBench
# had no end-to-end coverage at all.
#
# So this suite runs what a consumer runs: `vite build` + `vite preview` +
# Playwright for TracerBench, `vite dev` + Playwright + bippy for the profiler,
# on a React app, with a git worktree of a control commit as the baseline.
#
# In two shapes, because consumers come in two. Most cases below build a
# single-package repo, which is what the benches' defaults describe. The last
# case of each bench builds a pnpm workspace with the app one directory down —
# a nested `distDir`, and a `workspacePackages` list whose per-package
# `node_modules` symlinks are the only thing standing between the control leg
# and `Failed to resolve import "react"`. Both benches carry their own copy of
# that handling, it has run in production in `tilt` since it was written, and
# until these two cases nothing had ever executed it.
#
# The scenario is deliberately near-empty — mount the app, click a button.
# Proving the chain turns over is the point; a workload would only add noise to
# it. The app carries one knob instead: `src/rows.ts` says how many rows it
# renders, and moving it is how the "real regression" cases below make the
# experiment side measurably more expensive in both fiber renders and wall
# clock.
#
# Minutes, not seconds. This is the uppercase gate's, never `lgtm`'s.
set -u

# This suite runs from inside the repository it must not touch, and `make_repo`
# below `git init`s a scratch one. Git reads GIT_DIR and friends out of the
# environment and lets them win over `cwd`; a git hook exports them, and `cd`
# into a temp dir does NOT escape them. Unscrubbed, that `git init` addresses
# the REAL repository. Drop every repo-local git variable once, for this script
# and for everything it runs.
# shellcheck disable=SC2046  # intentional word-splitting of the var-name list
unset $(git rev-parse --local-env-vars)

script_dir="$(cd "$(dirname "$0")" && pwd)"
# The fixture repo borrows this package's `node_modules` — it needs a
# Playwright, a vite, a React, a `tsx`, an esbuild and a bippy, and installing
# six of them per test run would cost more than the suite. That is also why this
# file is not in `package.json#files`: it only runs from a checkout of this
# repo.
pkg_dir="$(cd "$script_dir/.." && pwd)"

fails=0
pass(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
# `$2` is a file worth reading when this went red. Its tail is printed here and
# not left as a path, because the scratch tree it lives in is gone by the time
# anyone reads this — and on CI it was never reachable in the first place.
fail(){
  printf '  \033[31m✗\033[0m %s\n' "$1"
  fails=$((fails + 1))
  [[ $# -lt 2 || ! -f "$2" ]] && return 0
  printf '    ── %s (last 25 lines) ──\n' "$2"
  tail -n 25 "$2" | sed 's/^/    /'
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# How many rows the control commit renders, and how many the "real regression"
# cases move it to. Both sides have to clear `--component-min-renders` for the
# profiler to gate at all, and the ratio has to clear a wall-clock width that a
# tiny app's noise does not — see the widths passed to each case below.
CONTROL_ROWS=100
REGRESSED_ROWS=6000

# ── The fixture app ──────────────────────────────────────────────────────────
#
# `fixtures/app/` — a real React app, on disk, in this repository. It runs
# on its own (`pnpm run fixture`, from this repo's root), which is the point
# of it being a directory: when a bench misbehaves you can start the app it
# was measuring and look at it.
#
# Only the *history* is synthesised here. Every case needs three git histories
# of the same app, so this suite `git init`s a scratch repo and fabricates
# commits — but what it commits is the fixture, copied in unchanged.
#
# It is as small as a React app both benches can drive gets: an entry, a
# component tree three deep, a `<React.Profiler>` zone because the profiler's
# report carries zone totals, and one exported constant that scales the work.
fixture_dir="$pkg_dir/fixtures/app"

# Named rather than a `cp -R` of the whole directory: a standalone run of the
# fixture leaves a `dist/`, a `node_modules/` and a results directory behind,
# and none of them belongs in a scratch repo. A fixture file added without a
# line here fails the very next run, loudly.
#
# Split in two because the fixture is copied in two layouts. `APP_ENTRIES` is
# the application — it moves as a unit into whatever directory the app lives
# in. `ROOT_ENTRIES` is the apparatus, and it stays at the scratch repo's root
# in both layouts: every path the two benches hand Playwright is repo-relative,
# and `profiler.sh` reads its spec and its config from `$ROOT_DIR/e2e/` and
# `$ROOT_DIR/` by name. A workspace does not move them; it moves the app out
# from under them.
APP_ENTRIES=(
  index.html
  package.json
  tsconfig.json
  src
)
ROOT_ENTRIES=(
  .gitignore
  playwright.profiler.config.ts
  playwright.tracerbench.config.ts
  e2e
)

# Where the app sits inside a scratch repo: the root in the flat layout, the
# app package in the workspace one. Read off the repo rather than passed
# around, so every call site stays one argument.
app_dir() {
  if [[ -f "$1/pnpm-workspace.yaml" ]]; then
    echo "$1/$WORKSPACE_APP"
  else
    echo "$1"
  fi
}

copy_app() {
  local repo="$1" app entry
  app="$(app_dir "$repo")"
  mkdir -p "$app"
  for entry in "${APP_ENTRIES[@]}"; do
    cp -R "$fixture_dir/$entry" "$app/$entry" || return 1
  done
  for entry in "${ROOT_ENTRIES[@]}"; do
    cp -R "$fixture_dir/$entry" "$repo/$entry" || return 1
  done

  # Set rather than inherited from the checkout: `CONTROL_ROWS` is what every
  # case below is calibrated against, and the committed value of `src/rows.ts`
  # is only what a standalone `pnpm run fixture` renders.
  set_rows "$repo" "$CONTROL_ROWS"

  # Same lockfile on both sides, so a control worktree symlinks `node_modules`
  # instead of installing into it. A property of the scratch repo rather than of
  # the fixture — `installable_control` below is the one case that breaks it on
  # purpose.
  : > "$repo/pnpm-lock.yaml"
}

# The one knob. Both benches read the same number: more rows is more fiber
# renders for the profiler and more milliseconds for TracerBench.
set_rows() {
  printf 'export const ROWS = %s;\n' "$2" > "$(app_dir "$1")/src/rows.ts"
}

# `node_modules` is a real directory of symlinks rather than one symlink to this
# package's, for one reason: the fixture has to resolve `@abernier/skills`
# itself — its Playwright configs import the config builders, its profiler spec
# imports the scan bundle path, and the profiler's `globalSetup` names the
# package. That entry has to be added, and adding it to a symlink would add it
# to this repository's own `node_modules`.
# The dotted entries are not optional: pnpm's `.bin` shims reach back into a
# sibling `.pnpm/` by a path relative to the `node_modules` they were invoked
# through, so a tree with `.bin` and no `.pnpm` has a `vite` that cannot find
# vite.
#
# `$2…` are entry names to leave out, which is how the workspace layout gets an
# honest root tree — see `APP_DEPS`.
link_node_modules() {
  local repo="$1"; shift
  local excluded=" $* " entry
  mkdir -p "$repo/node_modules/@abernier"
  for entry in "$pkg_dir/node_modules"/* "$pkg_dir/node_modules"/.[!.]*; do
    [[ "$excluded" == *" ${entry##*/} "* ]] && continue
    ln -s "$entry" "$repo/node_modules/"
  done
  ln -s "$pkg_dir" "$repo/node_modules/@abernier/skills"
}

# ── The workspace layout ─────────────────────────────────────────────────────
#
# The same fixture, one directory down, in a repo shaped the way the benches'
# `workspacePackages` handling is written for. Not a second app: `copy_app`
# above puts the very same files in both shapes.
WORKSPACE_APP="packages/app"

# The app package's own dependencies — the ones pnpm puts under the package
# rather than at the workspace root, because the root manifest never declares
# them.
#
# This is the whole reason the case bites. Node resolves an import by walking up
# from the file, so an app whose `react` is only ever reachable through the
# workspace root's `node_modules` would build fine in a control worktree that
# symlinked nothing but the root — and the case would pass while testing
# nothing. Splitting the tree the way pnpm splits it means a control worktree
# without `packages/app/node_modules` dies on `Failed to resolve import "react"`,
# which is exactly what `workspacePackages` exists to prevent.
APP_DEPS=(react react-dom vite)

# What pnpm leaves under a workspace package: its own dependencies, plus the
# `.bin`/`.pnpm` pair its shims need for the same reason the root tree does.
link_app_node_modules() {
  local app="$1" entry
  mkdir -p "$app/node_modules"
  for entry in "${APP_DEPS[@]}" .bin .pnpm; do
    ln -s "$pkg_dir/node_modules/$entry" "$app/node_modules/"
  done
}

# The workspace root's manifest, and the file that makes it one.
#
# This manifest is where the layout lives, and it is the only place it can live.
# Both benches address the repo they measure from its root — `pnpm run build`,
# `pnpm run test:*`, `$ROOT_DIR/e2e/`, every path they hand Playwright — so the
# specs and their configs stay at the root and only the app moves down. What
# tells the dev server and the preview server where it moved is `dev` and
# `preview` here, because the Playwright configs call them by name.
#
# Not an environment variable, and this is worth knowing outside the fixture:
# the profiler's two legs do not start the same way. The experiment leg runs
# `pnpm run test:profiler`; the control leg execs the worktree's `playwright`
# binary directly. So a `test:profiler` script that exports something — an env
# prefix, a `pre` step — exports it on one side only, and a bench whose control
# leg silently loses it reports a red PR that is not red. A command the config
# spells out is spawned by Playwright on both.
#
# The five script names are the fixture's own, read out of its manifest rather
# than restated here, so a rename over there cannot leave this behind.
write_workspace_root() {
  node -e '
    const fs = require("node:fs");
    const [fixtureDir, repoDir, appDir] = process.argv.slice(1);
    const app = JSON.parse(fs.readFileSync(fixtureDir + "/package.json", "utf8"));
    const scripts = {};
    // Delegated to the app package: the three that run vite in the app.
    for (const name of ["dev", "preview", "build"]) {
      scripts[name] = `pnpm -C ${appDir} run ${name}`;
    }
    // Verbatim: the two that run Playwright, which belongs at the root.
    for (const name of ["test:tracerbench", "test:profiler"]) {
      scripts[name] = app.scripts[name];
    }
    fs.writeFileSync(
      repoDir + "/package.json",
      JSON.stringify(
        { name: "workspace-fixture-root", private: true, type: "module", scripts },
        null,
        2,
      ) + "\n",
    );
  ' "$fixture_dir" "$1" "$WORKSPACE_APP"
  printf 'packages:\n  - %s\n' "${WORKSPACE_APP%/*}/*" > "$1/pnpm-workspace.yaml"
}

# One control commit is enough here: the control legs that cannot run are
# already covered above, in the layout where they are cheaper. What this shape
# tests is the layout itself.
make_workspace_repo() {
  local repo="$1"
  mkdir -p "$repo/$WORKSPACE_APP"
  # `pnpm-workspace.yaml` first — `app_dir` reads the layout off the repo.
  write_workspace_root "$repo"
  link_node_modules "$repo" "${APP_DEPS[@]}"
  link_app_node_modules "$repo/$WORKSPACE_APP"
  copy_app "$repo"
  # The app package keeps its own manifest; the root's is the one just written.
  write_workspace_bench_json "$repo"

  git -C "$repo" init -q -b main
  git -C "$repo" config user.email fixture@example.com
  git -C "$repo" config user.name fixture
  git -C "$repo" add -A
  git -C "$repo" commit -qm "the app, as a workspace package"
  git -C "$repo" branch control-ok
}

# Everything the single-package defaults get wrong about this repo, declared:
# where the app's sources are, where its bundle lands — and `workspacePackages`,
# the key this whole layout exists to exercise.
write_workspace_bench_json() {
  cat > "$1/bench.json" <<JSON
{
  "workspacePackages": ["$WORKSPACE_APP"],
  "distDir": "$WORKSPACE_APP/dist",
  "sourceRoots": ["$WORKSPACE_APP/src"],
  "thresholds": { "tracerbenchMs": 100 }
}
JSON
}

# A repository both benches can measure, with two control commits:
#
#   control-legacy — predates `src/rows.ts`, so the app neither builds nor
#                    boots. That is the shape both real consumers hit: an
#                    import the control side cannot resolve.
#   control-ok     — has it, and measures.
#
# The working tree is the experiment, as it is in a real run.
make_repo() {
  local repo="$1"
  mkdir -p "$repo"
  link_node_modules "$repo"
  copy_app "$repo"

  git -C "$repo" init -q -b main
  git -C "$repo" config user.email fixture@example.com
  git -C "$repo" config user.name fixture

  mv "$repo/src/rows.ts" "$repo/rows.hidden"
  git -C "$repo" add -A
  git -C "$repo" commit -qm "before the rows"
  git -C "$repo" branch control-legacy
  mv "$repo/rows.hidden" "$repo/src/rows.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -qm "with the rows"
  git -C "$repo" branch control-ok
}

# Declare this package's own dependency block in the fixture's manifest, and
# optionally `@abernier/skills` itself on top of it.
#
# Its own block because every one of those versions is already in the store this
# checkout filled, so an install of it is offline and takes about a second — and
# because the fixture needs exactly what it needs: a Playwright, a vite, a
# React. `link:` for the package itself, there being no registry here; what
# matters downstream is only that declaring it changes the lockfile.
write_manifest_deps() {
  node -e '
    const fs = require("node:fs");
    const [pkgDir, repoDir, withPlugin] = process.argv.slice(1);
    const own = JSON.parse(fs.readFileSync(pkgDir + "/package.json", "utf8"));
    const manifest = JSON.parse(fs.readFileSync(repoDir + "/package.json", "utf8"));
    manifest.devDependencies = { ...own.devDependencies };
    if (withPlugin) manifest.devDependencies["@abernier/skills"] = "link:" + pkgDir;
    manifest.pnpm = own.pnpm;
    fs.writeFileSync(repoDir + "/package.json", JSON.stringify(manifest, null, 2) + "\n");
  ' "$pkg_dir" "$1" "${2:-}"
}

# The other shape of control worktree: one the harness has to install into.
#
# Every case above borrows this package's `node_modules` wholesale and commits
# an empty lockfile, so both sides match and the control worktree just
# symlinks. The PR that *adds* the bench to a repo cannot look like that —
# adding a dependency changes the lockfile, and a worktree whose lockfile
# differs gets `pnpm install --frozen-lockfile` and the control's own tree.
#
# So: a commit that has the app, has Playwright, has vite, and has never heard
# of `@abernier/skills`, and a working tree — the experiment — that declares it.
# That is tilt's exact situation, and one specifier away from sizematters'.
installable_control() {
  local repo="$1"
  write_manifest_deps "$repo"
  cp "$pkg_dir/pnpm-lock.yaml" "$repo/pnpm-lock.yaml"
  git -C "$repo" add -A
  git -C "$repo" commit -qm "dependencies, and no bench harness"
  git -C "$repo" branch control-nodep

  write_manifest_deps "$repo" with-plugin
  # Real pnpm output on both sides, rather than a hand-edited YAML diff: what
  # the harness reads is `diff -q` between the two, and a synthetic difference
  # would prove the branch was taken without proving it was taken for the
  # reason a consumer takes it. Nothing installs from this one — the experiment
  # leg runs against the linked `node_modules` above.
  (cd "$repo" && pnpm install --lockfile-only) > "$repo/lockfile-only.log" 2>&1
}

# `bench.json`, or none at all. Absent, the defaults stand — `src`, `dist`, and
# no gate.
write_bench_json() {
  printf '{ "thresholds": { "tracerbenchMs": %s } }\n' "$2" > "$1/bench.json"
}

# Run a bench the way a consumer runs it. Sets `status` and `log`.
run_bench() {
  local repo="$1" bench="$2"; shift 2
  log="$repo/$bench.log"
  (
    cd "$repo" || exit 1
    bash "$script_dir/$bench.sh" "$@"
  ) > "$log" 2>&1
  status=$?
}

# Grep a run's artefacts without letting a missing file read as a match.
comment_says() { grep -qF "$2" "$1/comment.md" 2>/dev/null; }

started=$SECONDS
echo "bench harness, end to end (a real app, a real browser):"
echo ""

# ── TracerBench ───────────────────────────────────────────────────────────────
echo "tracerbench:"

# 1. Control == experiment. The chain turns over: two builds, two preview
#    servers, two Playwright runs, one comparison.
#
#    The width is wide because the fixture is small: a ~200 ms total is mostly
#    `page.goto` and click round-trips, whose spread on a busy machine is real.
#    Measured spread across runs here is ±7%; the regression case's knob moves
#    the total by ~+106%. Calibrating a gate is the consumer's job — this width
#    only has to sit well clear of the first and well under the second.
repo="$tmp/tb-same"
make_repo "$repo"
write_bench_json "$repo" 100
run_bench "$repo" tracerbench --control control-ok
if [[ $status -eq 0 ]]; then
  pass "an unchanged branch passes"
else
  fail "an unchanged branch exited $status" "$log"
fi
if comment_says "$repo/tracerbench-results" "**PASS**"; then
  pass "and the comment says PASS"
else
  fail "and the comment does not say PASS" "$repo/tracerbench-results/comment.md"
fi

# 2. A control that cannot run. For TracerBench that is the control build: the
#    spec and the preview server are the experiment's, and the only thing the
#    control side contributes is a bundle. No bundle, nothing to compare, and
#    the run must not be a pass.
repo="$tmp/tb-no-control"
make_repo "$repo"
write_bench_json "$repo" 100
run_bench "$repo" tracerbench --control control-legacy
if [[ $status -ne 0 ]]; then
  pass "a control that cannot build exits non-zero"
else
  fail "a control that cannot build exited 0" "$log"
fi
if comment_says "$repo/tracerbench-results" "PASS"; then
  fail "and it still emitted a PASS verdict" "$repo/tracerbench-results/comment.md"
else
  pass "and no PASS verdict was emitted"
fi

# 3. A real regression. Without this, case 1 would pass just as happily against
#    a harness that measured nothing.
repo="$tmp/tb-regression"
make_repo "$repo"
write_bench_json "$repo" 50
set_rows "$repo" "$REGRESSED_ROWS"
run_bench "$repo" tracerbench --control control-ok
if [[ $status -ne 0 ]]; then
  pass "a branch that got slower exits non-zero"
else
  fail "a branch that got slower exited 0" "$log"
fi
if comment_says "$repo/tracerbench-results" "**FAIL**"; then
  pass "and the comment says FAIL"
else
  fail "and the comment does not say FAIL" "$repo/tracerbench-results/comment.md"
fi

# 4. No threshold declared. The harness's stated contract is that an absent key
#    adds nothing rather than disabling something: the bench still builds, still
#    measures, still writes its comment — and neither passes nor fails.
repo="$tmp/tb-ungated"
make_repo "$repo"   # no bench.json at all
set_rows "$repo" "$REGRESSED_ROWS"
run_bench "$repo" tracerbench --control control-ok
if [[ $status -eq 0 ]]; then
  pass "an undeclared threshold does not fail the run"
else
  fail "an undeclared threshold exited $status" "$log"
fi
if comment_says "$repo/tracerbench-results" "**NO GATE**" \
  && ! comment_says "$repo/tracerbench-results" "**PASS**"; then
  pass "and the comment says NO GATE rather than PASS"
else
  fail "and the comment did not say NO GATE" "$repo/tracerbench-results/comment.md"
fi

# 5. A workspace. Everything above is a single-package repo, which is the shape
#    the defaults are written for and the shape that exercises none of the
#    workspace handling in `tracerbench.sh`: a `distDir` that is not `dist`, and
#    a control worktree that needs the app package's own `node_modules`
#    symlinked alongside the root one. The comment at `tracerbench.sh:99` says
#    the two go together, and until this case nothing said whether they did.
#
#    Same fixture, one directory down. The gate width is the flat case's — the
#    app is the same app and its 100 rows cost the same milliseconds.
repo="$tmp/tb-workspace"
make_workspace_repo "$repo"
run_bench "$repo" tracerbench --control control-ok
if [[ $status -eq 0 ]]; then
  pass "a workspace repo passes"
else
  fail "a workspace repo exited $status" "$log"
fi
# Both sides built, and both built where `distDir` said. A control worktree
# that got only the root `node_modules` never reaches this: `vite build` dies
# on `Failed to resolve import "react"`, the run stops there under `set -e`,
# and there is no control bundle to find.
if [[ -d "$repo/$WORKSPACE_APP/dist-control" \
   && -d "$repo/$WORKSPACE_APP/dist-experiment" ]]; then
  pass "and both bundles landed under the nested distDir"
else
  fail "and a bundle is missing from $WORKSPACE_APP/" "$log"
fi
if comment_says "$repo/tracerbench-results" "**PASS**"; then
  pass "and the comment says PASS"
else
  fail "and the comment does not say PASS" "$repo/tracerbench-results/comment.md"
fi

echo ""
echo "profiler:"

# The profiler's gate is per-component render counts, and it only judges
# components both sides rendered at least `--component-min-renders` times.
# `--strict` because the bench is soft by default and a soft run exits 0
# whatever it found — `bench.lgtm.sh` passes the same pair.
PROFILER_ARGS=(--strict --component-threshold 20 --component-min-renders 20)

# 1. Control == experiment: every delta is 0, and unlike wall clock that is
#    literal here — fiber render counts are deterministic.
repo="$tmp/prof-same"
make_repo "$repo"
run_bench "$repo" profiler "${PROFILER_ARGS[@]}" --control control-ok
if [[ $status -eq 0 ]]; then
  pass "an unchanged branch passes"
else
  fail "an unchanged branch exited $status" "$log"
fi
if comment_says "$repo/profiler-results" "✅ PASS"; then
  pass "and the comment says PASS"
else
  fail "and the comment does not say PASS" "$repo/profiler-results/comment.md"
fi

# 2. The regression of the day, with a browser this time: the control leg boots
#    a dev server that serves a 500 for the missing module, the app never
#    mounts, the spec dies before writing its commit log, and the side gets no
#    report. Before the fix this diffed the experiment against itself and
#    printed `✅ PASS`.
repo="$tmp/prof-no-control"
make_repo "$repo"
run_bench "$repo" profiler "${PROFILER_ARGS[@]}" --control control-legacy
if [[ $status -ne 0 ]]; then
  pass "a control that cannot run exits non-zero"
else
  fail "a control that cannot run exited 0" "$log"
fi
if comment_says "$repo/profiler-results" "not a pass"; then
  pass "and the comment says the run is not a pass"
else
  fail "and the comment does not say the run is not a pass"
fi
if comment_says "$repo/profiler-results" "mount"; then
  pass "and the experiment-only summary is still emitted"
else
  fail "and the experiment-only summary was dropped"
fi

# 3. A real regression — sixty times the rows, sixty times the fiber renders.
#    Deterministic, where the wall-clock half of this had to be calibrated: a
#    render either happened or it did not.
repo="$tmp/prof-regression"
make_repo "$repo"
set_rows "$repo" "$REGRESSED_ROWS"
run_bench "$repo" profiler "${PROFILER_ARGS[@]}" --control control-ok
if [[ $status -ne 0 ]]; then
  pass "a branch that renders more exits non-zero"
else
  fail "a branch that renders more exited 0" "$log"
fi
if comment_says "$repo/profiler-results" "❌ FAIL"; then
  pass "and the comment says FAIL"
else
  fail "and the comment does not say FAIL" "$repo/profiler-results/comment.md"
fi
if comment_says "$repo/profiler-results" "Row"; then
  pass "and it names the component that regressed"
else
  fail "and it does not name the component that regressed"
fi

# 4. A control that never had the harness. Its lockfile differs, so the
#    worktree installs the control's own tree — Playwright, vite, React, and no
#    `@abernier/skills`. The spec and the config running there are the
#    experiment's and import it by name, so without the overlay the control leg
#    dies at config load on `Cannot find package '@abernier/skills'` and the run
#    reports no baseline: a red verdict about a PR that has nothing wrong with
#    it. The control supplies the application, the experiment supplies the
#    apparatus, and the two sides are comparable again.
repo="$tmp/prof-installs-control"
make_repo "$repo"
installable_control "$repo"
run_bench "$repo" profiler "${PROFILER_ARGS[@]}" --control control-nodep
# First that the case is the case: a run that quietly took the symlink path
# would pass these assertions while exercising none of this.
if grep -qF "lockfile differs" "$log"; then
  pass "a differing lockfile makes the control worktree install its own tree"
else
  fail "a differing lockfile did not make the control worktree install" "$log"
fi
if [[ $status -eq 0 ]]; then
  pass "and a control that never had the harness is still measured"
else
  fail "and a control that never had the harness exited $status" "$log"
fi
if comment_says "$repo/profiler-results" "✅ PASS" \
  && ! comment_says "$repo/profiler-results" "not a pass"; then
  pass "and the comment is a comparison, not a one-sided summary"
else
  fail "and the comment is not a comparison" "$repo/profiler-results/comment.md"
fi

# 5. The same workspace, through the other bench. `profiler.sh` carries its own
#    copy of the `workspacePackages` loop, so covering it once covers one of
#    them — and this is the half where the symlink is load-bearing at run time
#    rather than at build time: the control leg boots a dev server in the app
#    package, and a package with no `node_modules` serves a 500 for `react`,
#    the app never mounts, and the side records nothing.
#
#    Which is the same shape as case 2 above, and that is the point of the last
#    two assertions: a workspace whose control leg was never given its
#    dependencies looks exactly like a control that cannot run.
repo="$tmp/prof-workspace"
make_workspace_repo "$repo"
run_bench "$repo" profiler "${PROFILER_ARGS[@]}" --control control-ok
if [[ $status -eq 0 ]]; then
  pass "a workspace repo passes"
else
  fail "a workspace repo exited $status" "$log"
fi
if [[ -f "$repo/profiler-results/control/report.json" ]]; then
  pass "and the control leg, in its own package, was measured too"
else
  fail "and the control leg produced no report" "$log"
fi
if comment_says "$repo/profiler-results" "✅ PASS" \
  && ! comment_says "$repo/profiler-results" "not a pass"; then
  pass "and the comment is a comparison, not a one-sided summary"
else
  fail "and the comment is not a comparison" "$repo/profiler-results/comment.md"
fi

# The `--no-gate` case has no profiler half. Its gate widths are flags with
# defaults in `profiler.compare.ts`, not `bench.json` keys — there is no absent
# key for the absent-key rule to be about.

echo ""
printf 'ran in %ds\n' "$((SECONDS - started))"
if [[ $fails -gt 0 ]]; then
  echo "$fails failing"
  exit 1
fi
echo "all good"
