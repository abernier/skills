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
trap 'rm -rf "$tmp"' EXIT

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
import { test } from "@playwright/test";

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

echo ""
if [[ $fails -gt 0 ]]; then
  echo "$fails failing"
  exit 1
fi
echo "all good"
