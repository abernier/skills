#!/usr/bin/env bash
# profiler.test.sh — what `profiler.sh` does when a side fails to produce a
# report.
#
# Scope: the composition, not the measurements. The bug this suite exists for
# lived in none of the pieces — `profiler.aggregate.ts` refused an unfoldable
# log, `profiler.compare.ts` diffed what it was given, `bench.lgtm.sh` rendered
# the status it was handed — and in how they were wired: a control leg that died
# at config load left no report, the script diffed the experiment against itself,
# printed `✅ PASS` and exited 0. Two repos shipped a green `lgtm-perf` off it.
# Only a run of the whole script can catch that, so this is a run of the whole
# script.
#
# Without a browser, and in about a second a side: the fixture's spec writes a
# commit log directly instead of driving an app, which is all the harness ever
# reads from it. Everything else is real — the worktree, the scan bundle, both
# Playwright invocations, `profiler.aggregate.ts`, `profiler.compare.ts`.
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
# Playwright, a `tsx` and an esbuild, and installing three of them per test run
# would cost more than the suite. That is also why this file is not in
# `package.json#files`: it only runs from a checkout of this repo.
pkg_dir="$(cd "$script_dir/.." && pwd)"

fails=0
pass(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail(){ printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }

tmp="$(mktemp -d)"
# `PROFILER_TEST_KEEP=1` leaves the fixture repos and their run logs behind.
# A failing case here is a whole harness run, and the only way to read why is
# the log inside the repo it ran in — which the teardown takes with it.
trap '[[ -n "${PROFILER_TEST_KEEP:-}" ]] && echo "kept: $tmp" || rm -rf "$tmp"' EXIT

# This suite runs the real `profiler.sh`, which takes the machine-wide bench
# lock — and it runs inside `lgtm`, which has to stay fast. Pointing TMPDIR at
# this run's scratch directory gives it a lock of its own, so it neither queues
# behind a bench someone is running here nor blocks one.
export TMPDIR="$tmp"

# A repository the profiler can bench, with two control branches:
#
#   control-legacy  — predates `e2e/fixture.ts`, so the experiment's spec, copied
#                     into its worktree, dies at load. That is how both repos hit
#                     this in the wild: an import the control side cannot resolve.
#   control-ok      — has it, and measures.
#
# The working tree is the experiment, as it is in a real run.
make_repo() {
  local repo="$1"
  # Which side's spec asserts something false — "" for neither. The spec writes
  # its commit log first either way, so the failing side still produces a report
  # and the comparison still happens: what is under test is the leg's *verdict*,
  # not a missing report.
  local fail_side="${2:-}"
  mkdir -p "$repo/e2e"
  ln -s "$pkg_dir/node_modules" "$repo/node_modules"

  cat > "$repo/package.json" <<'JSON'
{
  "name": "profiler-fixture",
  "private": true,
  "type": "module",
  "scripts": {
    "test:profiler": "playwright test --config playwright.profiler.config.ts"
  }
}
JSON

  cat > "$repo/playwright.profiler.config.ts" <<'TS'
import { defineConfig } from "@playwright/test";

export default defineConfig({ testDir: "e2e", reporter: "line" });
TS

  cat > "$repo/e2e/profiler.spec.ts" <<'TS'
import * as fs from "node:fs";
import { expect, test } from "@playwright/test";

// Absent on `control-legacy`. A control that cannot resolve what the copied
// spec imports fails before it measures anything — no browser required to
// reproduce that.
import { STEPS } from "./fixture.js";

test("records a commit log", () => {
  fs.writeFileSync(
    process.env.PROFILER_COMMITS!,
    JSON.stringify({ schemaVersion: 2, generatedAt: "", url: "", steps: STEPS }),
  );
});
TS

  cat > "$repo/e2e/fixture.ts" <<'TS'
export const STEPS = [
  {
    step: "drag",
    durationMs: 120,
    totalCommits: 1,
    byId: {
      root: {
        mount: { count: 1, actualMs: 8, baseMs: 8 },
        update: { count: 4, actualMs: 3, baseMs: 3 },
      },
    },
    commits: [
      {
        renders: [
          { name: "Board", cause: { kind: "state" }, selfTime: 1, baseTime: 2 },
          {
            name: "Card",
            cause: { kind: "props", changed: ["xywh"] },
            selfTime: 0.5,
            baseTime: 0.8,
          },
        ],
      },
    ],
  },
];
TS

  # A catalogue's own assertion, the kind no percentage threshold can express —
  # `tilt`'s is "this gesture must not commit React once per pointer event".
  # Both sides run the experiment's copy of the spec, so the side it fails on is
  # read at runtime from the path it was handed.
  if [[ -n "$fail_side" ]]; then
    cat >> "$repo/e2e/profiler.spec.ts" <<TS

test("the catalogue's own assertion", () => {
  // The path segment, not a substring of the whole path: this fixture's own
  // directory is named after the case, and matching the bare word matched that
  // too — failing the experiment side of a control-side case. (No backticks in
  // here: this heredoc interpolates, so they would run as a command.)
  const side = process.env.PROFILER_COMMITS!.includes("/control/")
    ? "control"
    : "experiment";
  expect(side, "the catalogue's own assertion failed").not.toBe("$fail_side");
});
TS
  fi

  # Two components under the default source root, so `isCodebaseComponent`
  # resolves the names the commit logs below use. Without them every render in
  # this fixture is "external" and the actionable half of the comparer — the
  # one the gates read — sees nothing at all.
  mkdir -p "$repo/src"
  cat > "$repo/src/Board.tsx" <<'TSX'
export function Board() {
  return null;
}
TSX
  cat > "$repo/src/Card.tsx" <<'TSX'
export function Card() {
  return null;
}
TSX

  # Same lockfile on both sides, so the control worktree symlinks `node_modules`
  # instead of installing into it.
  : > "$repo/pnpm-lock.yaml"
  printf 'node_modules\nprofiler-results\ntest-results\n' > "$repo/.gitignore"

  git -C "$repo" init -q -b main
  git -C "$repo" config user.email fixture@example.com
  git -C "$repo" config user.name fixture

  mv "$repo/e2e/fixture.ts" "$repo/fixture.hidden"
  git -C "$repo" add -A
  git -C "$repo" commit -qm "before the profiler"
  git -C "$repo" branch control-legacy
  mv "$repo/fixture.hidden" "$repo/e2e/fixture.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -qm "with the profiler"
  git -C "$repo" branch control-ok
}

# A step that rendered nothing on the control and renders on the experiment.
#
# Both sides read it from their own `e2e/quiet.ts`: the committed one costs
# nothing, and the working tree — which *is* the experiment, as in a real run —
# overwrites it with $2 renders. It has to exist on both sides, because the
# harness copies the experiment's spec into the control worktree and a spec
# importing a file the control does not have dies at load, which is a different
# case entirely (and already covered above).
silent_step() {
  local repo="$1"
  local renders="$2"

  quiet_file "$repo" 0
  perl -0pi -e 's|import \{ STEPS \} from "./fixture.js";|import { STEPS } from "./fixture.js";\nimport { QUIET } from "./quiet.js";|' "$repo/e2e/profiler.spec.ts"
  perl -0pi -e 's|steps: STEPS|steps: [...STEPS, QUIET]|' "$repo/e2e/profiler.spec.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -qm "a step that costs nothing"
  git -C "$repo" branch -f control-ok

  quiet_file "$repo" "$renders"
}

# `e2e/quiet.ts` with $2 renders of `Board` — 0 writes a step with no commits
# at all, which is what "rendered nothing" means to the aggregate.
quiet_file() {
  local repo="$1"
  local n="$2"
  # No commits at all when n is 0 — "rendered nothing" as the aggregate reads
  # it, which is the shape the control side of a silent step really has.
  local commits="[]"
  if [[ "$n" -gt 0 ]]; then
    commits="[{ renders: Array.from({ length: $n }, () => ({ name: \"Board\", cause: { kind: \"state\" }, selfTime: 1, baseTime: 2 })) }]"
  fi
  cat > "$repo/e2e/quiet.ts" <<TS
export const QUIET = {
  step: "quiet",
  durationMs: 40,
  totalCommits: $n,
  byId: {
    root: {
      mount: { count: 0, actualMs: 0, baseMs: 0 },
      update: { count: $n, actualMs: 1, baseMs: 1 },
    },
  },
  commits: $commits,
};
TS
}

# Run the bench the way `lgtm-perf` runs it. Sets `status` and `log`.
run_profiler() {
  local repo="$1"; shift
  log="$repo/run.log"
  (
    cd "$repo" || exit 1
    bash "$script_dir/profiler.sh" --strict --component-threshold 20 "$@"
  ) > "$log" 2>&1
  status=$?
}

echo "profiler harness:"

# ── A control that never produced a report is not a pass ─────────────────────
#
# The regression, exactly: before the fix this printed `✅ PASS — 0 component
# blockers` and exited 0, and `lgtm-perf` rendered it `profiler : ✅ pass`.
repo="$tmp/no-control"
make_repo "$repo"
run_profiler "$repo" --control control-legacy

if [[ $status -ne 0 ]]; then
  pass "a missing control report exits non-zero"
else
  fail "a missing control report exited 0 — a run that measured one side read as a pass"
fi

if grep -q "not a pass" "$repo/profiler-results/comment.md" 2>/dev/null; then
  pass "the comment says the run is not a pass"
else
  fail "the comment does not say the run is not a pass"
fi

# The summary is still worth printing — it is the deliverable on the PR that
# introduces the bench to a repo. What must not survive is the verdict.
if grep -q "drag" "$repo/profiler-results/comment.md" 2>/dev/null; then
  pass "the experiment-only summary is still emitted"
else
  fail "the experiment-only summary was dropped"
fi

# ── A missing experiment report is not a pass either ──────────────────────────
repo="$tmp/no-experiment"
make_repo "$repo"
rm "$repo/e2e/fixture.ts"   # the working tree — the experiment side — loses it
run_profiler "$repo" --control control-ok

if [[ $status -ne 0 ]]; then
  pass "a missing experiment report exits non-zero"
else
  fail "a missing experiment report exited 0"
fi

# ── Both sides measured: the gate still passes ───────────────────────────────
#
# The other half of the rule. A fix that reddened every run would satisfy the
# first three cases and be useless.
repo="$tmp/both"
make_repo "$repo"
run_profiler "$repo" --control control-ok

if [[ $status -eq 0 ]]; then
  pass "two reports and no regression still exits 0"
else
  fail "two reports and no regression exited $status — see $log"
fi

if grep -q "PASS" "$log"; then
  pass "and says PASS"
else
  fail "and did not say PASS — see $log"
fi

# ── A red experiment leg is a red run ────────────────────────────────────────
#
# Both sides measure, the comparer finds nothing, and the run is still red —
# because the branch's own spec said so. Before the fix this was the shape of a
# silent false green: `tilt` planted a camera-state leak (orbit 2 → 444 React
# commits), the spec caught it, the leg exited 1, and `lgtm-perf` printed
# `profiler : ✅ pass` and exited 0.
repo="$tmp/experiment-leg-red"
make_repo "$repo" experiment
run_profiler "$repo" --control control-ok

if [[ $status -ne 0 ]]; then
  pass "a failing experiment leg exits non-zero"
else
  fail "a failing experiment leg exited 0 — the spec's own verdict was dropped"
fi

# The half that says the verdict came from the leg and not from the comparer: a
# run that reddened because a component regressed would prove nothing here.
if grep -q "PASS" "$log"; then
  pass "even though the comparison itself found no regression"
else
  fail "the comparison did not pass — this case no longer isolates the leg"
fi

# ── A red control leg is not this branch's problem ───────────────────────────
#
# The other half of the rule. The control measures the base branch, and
# reddening a PR for what main asserts about itself would block work on a
# finding its author cannot fix from here.
repo="$tmp/control-leg-red"
make_repo "$repo" control
run_profiler "$repo" --control control-ok

if [[ $status -eq 0 ]]; then
  pass "a failing control leg does not redden the run"
else
  fail "a failing control leg exited $status — see $log"
fi

# ── A step that rendered nothing and now renders is a red run ────────────────
#
# The hole the component gate cannot cover: a component with no renders on the
# control is classed `new`, and `new` never blocks — rightly, since a PR that
# adds a component takes it from 0 to N. A *step* cannot use that excuse: the
# catalogue is the same gesture on both sides. Measured on `tilt`, where a
# `setState` on the camera controls' `onChange` took `zoom` from 0 to 2,937
# fiber renders and the run stayed green.
repo="$tmp/silent-step"
make_repo "$repo"
silent_step "$repo" 40
run_profiler "$repo" --control control-ok

if [[ $status -ne 0 ]]; then
  pass "a step that rendered nothing on the control and renders here exits non-zero"
else
  fail "a silent step that started rendering exited 0 — see $log"
fi

# The verdict line, not the step name: `quiet` also appears in the zone table
# of a perfectly green run, so grepping for it alone would pass with the gate
# removed.
if grep -q "rendered nothing on the control" "$repo/profiler-results/comment.md" 2>/dev/null; then
  pass "and the verdict says which step, and why"
else
  fail "the verdict does not name the silent step — see $repo/profiler-results/comment.md"
fi

# ── Below the floor it is noise, not a finding ───────────────────────────────
#
# The half that keeps the gate from reddening on a step that renders twice
# because a tooltip mounted. Same fixture, under `--step-min-renders`.
repo="$tmp/silent-step-small"
make_repo "$repo"
silent_step "$repo" 4
run_profiler "$repo" --control control-ok --step-min-renders 20

if [[ $status -eq 0 ]]; then
  pass "a handful of renders under the floor does not gate"
else
  fail "a step under --step-min-renders reddened the run — see $log"
fi

# ── The control side is measured once, then reused ───────────────────────────
#
# Around 90 s of every run is the control leg re-measuring a branch that has not
# moved. Render counts are reproducible where milliseconds are not, so that leg's
# report is cached — and every case below is about the single way that can go
# wrong: an entry outliving what it was keyed on, handing the comparer a
# baseline for code that is no longer there. That reads as a **green** run, and
# says nothing on its way past.
#
# `bench.json` here does what tilt's does with `e2e/marks.ts`: it names a file
# the experiment hands to the control worktree, so the catalogue both sides run
# is the working tree's. It is written only for these cases — handing
# `e2e/fixture.ts` forward would give `control-legacy` the very import it is
# supposed to be missing.
repo="$tmp/cache"
make_repo "$repo"
cat > "$repo/bench.json" <<'JSON'
{ "controlWorktreeCopy": ["e2e/fixture.ts"] }
JSON

# Names what the log says the run did with its control side, so a case below
# reads as the question it is asking rather than as a grep.
control_was() {
  if grep -q "Reusing the cached control report" "$log"; then
    echo reused
  elif grep -q "Preparing control worktree" "$log"; then
    echo measured
  else
    echo neither
  fi
}

run_profiler "$repo" --control control-ok
if [[ "$(control_was)" == measured ]]; then
  pass "a cold cache measures the control side"
else
  fail "a cold cache did not measure the control side — see $log"
fi

run_profiler "$repo" --control control-ok
if [[ "$(control_was)" == reused ]]; then
  pass "an identical second run reuses that report instead of measuring again"
else
  fail "the second run measured the control side again — see $log"
fi

# The other half, and the one that matters: reusing must not cost the run its
# verdict. A cache that skipped the comparison would satisfy the line above.
if [[ $status -eq 0 ]] && grep -q "PASS" "$log"; then
  pass "and still compares both sides, and still passes"
else
  fail "the run on a reused baseline exited $status — see $log"
fi

if grep -q "reused from cache" "$repo/profiler-results/comment.md" 2>/dev/null; then
  pass "and the comment says the baseline was reused, and names its key"
else
  fail "the comment does not say the baseline was reused"
fi

# A hit has to leave the same artefacts behind as the run it stands in for, and
# the raw commit log is the big one — 32.6 MB on `tilt` against 375 KB for the
# report folded out of it, which is why it is stored compressed. Both halves
# matter: that it is small on disk, and that it still reads back byte for byte.
entry="$(ls -d "$repo/.git/profiler-control-cache"/*/ 2>/dev/null | head -1)"
if [[ -f "$entry/commits.json.gz" && ! -f "$entry/commits.json" ]]; then
  pass "the cached commit log is stored compressed, never raw"
else
  fail "the cached commit log was stored raw — 32 MB an entry on a real repo"
fi
if [[ -f "$repo/profiler-results/control/commits.json" ]] &&
  gunzip -c "$entry/commits.json.gz" | cmp -s - "$repo/profiler-results/control/commits.json"; then
  pass "and a hit restores it byte for byte"
else
  fail "the restored commit log does not match what was cached"
fi

# ── A key that moves invalidates ─────────────────────────────────────────────
#
# The base branch advanced. Same tree, new commit — enough, because what must be
# in the key is the commit: this is the entry whose reuse would compare a PR
# against a baseline for code that is no longer on the branch it names.
git -C "$repo" branch -f control-ok "$(
  git -C "$repo" commit-tree "$(git -C "$repo" rev-parse "control-ok^{tree}")" \
    -p control-ok -m "the base branch moves"
)"
run_profiler "$repo" --control control-ok
if [[ "$(control_was)" == measured ]]; then
  pass "a control branch that advanced invalidates it"
else
  fail "a moved control branch was still served from cache — see $log"
fi

# The catalogue changed. Both sides run the working tree's copy of it, so a
# report measured under the old one is a report of a different bench — this is
# `e2e/marks.ts` in the repo this harness was written for.
perl -0pi -e 's/durationMs: 120/durationMs: 121/' "$repo/e2e/fixture.ts"
run_profiler "$repo" --control control-ok
if [[ "$(control_was)" == measured ]]; then
  pass "a file the control worktree is handed invalidates it"
else
  fail "an edited controlWorktreeCopy file was still served from cache — see $log"
fi

# ── Two escape hatches, because they open onto different rooms ───────────────
#
# `--no-cache` is for `pnpm exec profiler`. The environment variable is the only
# one that survives `lgtm-perf`, which forwards its arguments to `tracerbench.sh`
# too — where `--no-cache` is not an option and would kill the gate in its parser.
run_profiler "$repo" --control control-ok --no-cache
if [[ "$(control_was)" == measured ]]; then
  pass "--no-cache re-measures a baseline somebody stopped trusting"
else
  fail "--no-cache was served from cache — see $log"
fi

PROFILER_CONTROL_CACHE=0 run_profiler "$repo" --control control-ok
if [[ "$(control_was)" == measured ]]; then
  pass "and so does PROFILER_CONTROL_CACHE=0, which is the one that reaches lgtm-perf"
else
  fail "PROFILER_CONTROL_CACHE=0 was served from cache — see $log"
fi

# And the hatch still leaves a usable entry behind: refusing to write would make
# the next run pay for the same doubt again.
run_profiler "$repo" --control control-ok
if [[ "$(control_was)" == reused ]]; then
  pass "a forced re-measure still leaves the fresh report for the next run"
else
  fail "the report from a forced re-measure was not kept — see $log"
fi

# ── A control leg that failed is not a baseline ──────────────────────────────
#
# It still writes a report — the spec records before it asserts — so "there is a
# report" is not the test. Caching one would freeze a run that did not happen
# the way it was meant to in as the baseline for every later run on the branch.
repo="$tmp/cache-red-control"
make_repo "$repo" control
run_profiler "$repo" --control control-ok
run_profiler "$repo" --control control-ok
if [[ "$(control_was)" == measured ]]; then
  pass "a control leg that failed its own assertions is not kept"
else
  fail "a failed control leg was cached as the baseline — see $log"
fi

echo ""
if [[ $fails -gt 0 ]]; then
  echo "$fails failing"
  exit 1
fi
echo "all good"
