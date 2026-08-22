#!/usr/bin/env bash
# branchstat.test.sh — bucketing and rendering tests for branchstat.sh.
#
# It drives the shell entry point, so it covers both halves: the git and cloc
# plumbing here, and the bucketing, rollup and rendering in
# branchstat-report.mts that it pipes into. That is why it stayed the net when
# those moved out of a jq program and into TypeScript, and again when the pair
# moved out of one repo and into this plugin — every assertion below held across
# both ports, unchanged.
#
# Scope: the classifier, the module rollup, and a smoke test per renderer. The
# regexes drift silently when a naming convention changes, and they are pure — a
# path in, a bucket out. The rollup is the same kind of thing: a path in, a
# module out, and a wrong grouping still reads as a plausible table. Rendering is
# format-only, but a broken `--md` surfaces as a malformed PR comment rather than
# a failing command, so each renderer gets one end-to-end call. The git and cloc
# plumbing in between needs nothing: it runs on every invocation and fails loudly.
set -u

# Run from a git hook, or from anything else that exports GIT_DIR/GIT_WORK_TREE,
# `cd` into a temp dir does NOT escape them — so without scrubbing, the
# `git init` / `git branch -M main` calls below address the REAL repo: they set
# core.bare=true (breaking `git status` in every worktree) and force-rename the
# checked-out branch onto main. Clear every repo-local git env var so the temp
# repos below are truly isolated.
# shellcheck disable=SC2046  # intentional word-splitting of the var-name list
unset $(git rev-parse --local-env-vars)

script="$(cd "$(dirname "$0")" && pwd)/branchstat.sh"
fails=0
pass(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail(){ printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }

# Rows carry a share bar between the name and the counts, drawn in block
# characters. Every assertion below is about the name or the numbers, so they
# read a de-barred copy: dropping every byte outside printable ASCII removes the
# blocks whether or not this sed is multibyte-aware, and the elision ellipsis
# with them. The bar has assertions of its own.
debar(){ sed 's/[^ -~]//g'; }

# bucket <path> <expected> [why]
bucket(){
  local got
  got="$(echo "$1" | bash "$script" --classify | cut -d' ' -f1)"
  if [ "$got" = "$2" ]; then
    pass "${3:-$1} → $2"
  else
    fail "${3:-$1} — expected [$2], got [$got]"
  fi
}

echo "branchstat:"

bucket src/App.tsx source
bucket src/Calibration.camera.ts source
bucket scripts/branchstat.sh source "a tooling script is logic, not config"
bucket .claude/hooks/gen-stack.sh source "an agent hook is logic too"
bucket db/migrations/014_count_lifetime_supporters.sql source
bucket lang/en.json source "product strings, not a knob"
bucket index.html source

bucket src/App.test.ts tests
bucket src/App.scene.browser.test.ts tests "a dotted test suffix still reads as a test"
bucket e2e/scenario.spec.ts tests
bucket e2e/gestures.ts tests "an e2e helper is test code"
bucket src/App.stories.tsx tests "Storybook never ships"
bucket .storybook/preview.tsx tests
bucket .claude/hooks/gen-stack.test.sh tests
bucket src/__tests__/legacy.ts tests

bucket package.json config
bucket tsconfig.json config
bucket vite.config.ts config
bucket vite.config.mcp-app.ts config "a suffixed config is still a config"
bucket eslint.config.ts config
bucket lint-staged.config.mjs config
bucket .prettierrc.json config
bucket .github/workflows/ci.yml config
bucket .github/scripts/mark-bench-comment-stale.cjs config
bucket .husky/pre-commit config
bucket .gitignore config
bucket packages/www/.gitignore config "a nested dotfile counts too"
bucket .env.development config
bucket deploy/config.toml config

# Tests win over config where both match: these exist only because we test.
bucket playwright.config.ts tests "test tooling beats config"
bucket vitest.browser.config.ts tests "test tooling beats config"
bucket src/vitest-browser.setup.ts tests
bucket chromatic.config.json tests
bucket .github/workflows/chromatic.yml config "but a CI workflow stays CI"

# --classify answers alone, but it is not a positional special case: it parses
# like every other flag, wherever the caller puts it. It used to be read off $1
# only, so anything before it died on "unknown option".
anywhere="$(echo src/App.tsx | bash "$script" --md --classify)"
[ "$anywhere" = "source src/App.tsx" ] &&
  pass "--classify: parses in any position" ||
  fail "--classify: parses in any position — got [$anywhere]"

# ── Renderers ────────────────────────────────────────────────────────────────
# A throwaway repo with one file per bucket, so both renderings have something
# to show in every row, and a dot-scoped family in the source bucket so the
# rollup has both levels to render.
has(){ case "$2" in *"$1"*) pass "$3" ;; *) fail "$3 — missing [$1]" ;; esac; }

if command -v cloc > /dev/null; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  (
    cd "$tmp" || exit 1
    git init -q . && git branch -M main
    git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
    # A dot-scoped family (Plane, Plane.tile, Plane.tile.label) so the module
    # rollup has something to roll up, plus a lone file so the "when applicable"
    # case is exercised in the same run. Plane.tile holds two files, and it is
    # not the module's only sub-scope, so the sub-module level must appear.
    for i in $(seq 20); do printf 'export const a%s = %s\n' "$i" "$i"; done > Plane.tile.ts
    printf 'export const l = 1\n' > Plane.tile.label.ts
    printf 'export const p = 1\n' > Plane.ts
    printf 'export const b = 2\n' > b.ts
    printf 'test("a", () => {})\n' > Plane.test.ts
    printf '{ "name": "x" }\n' > package.json
    # Excluded from the breakdown, counted by the total: the two numbers have to
    # be able to disagree for either assertion below to mean anything.
    for i in $(seq 5); do printf 'prose %s\n' "$i"; done > README.md
    git add -A && git -c user.email=t@t -c user.name=t commit -q -m work
  )
  text="$(cd "$tmp" && bash "$script" main~1)"
  md="$(cd "$tmp" && bash "$script" --md main~1)"

  has "source" "$text" "text: names the source bucket"
  has "net" "$text" "text: labels the net column"

  # The headline is the whole diff, git's own defaults, which is what a PR page
  # reports — README.md included, though nothing below the line counts it. It is
  # pinned as a literal rather than recomputed here: recomputing it with the same
  # command the script runs would assert only that git is deterministic.
  # 7 files, 30 lines: 25 of code and config, 5 of prose.
  total="7 files changed, 30 insertions(+) · as GitHub counts it"
  has "$total" "$text" "text: the total counts the whole diff, as GitHub does"
  has "$total" "$md" "md: the total counts the whole diff, as GitHub does"
  case "$text" in
    *README*) fail "text: an excluded file reached the breakdown" ;;
    *) pass "text: the total counts what the breakdown excludes, and only it" ;;
  esac
  has "## 📐 Branch size — net diff by bucket" "$md" "md: emits the heading"
  has '```text' "$md" "md: fences the report"
  has "net lines of source" "$md" "md: leads with the source net"
  # The repro line names the script as this caller reached it — an absolute path
  # here, since the temp repo is not where the plugin lives.
  has "$script main~1" "$md" "md: names the command that reproduces it"
  has "Data for " "$md" "md: carries the shared footer's revision line"
  case "$text" in
    *"Reproduce locally"*) fail "text: leaked the markdown footer" ;;
    *) pass "text: keeps the markdown footer out" ;;
  esac
  has "Plane carries 96%" "$text" "text: names the module that took the charge"
  has "Plane carries 96%" "$md" "md: names the module that took the charge"
  has "<details><summary>Per module" "$md" "md: folds the rollup away"

  # The rollup: Plane holds three of the four source files, and its subtotal has
  # to be the sum of them — a header that reports anything else is worse than no
  # header at all. b.ts stands alone, so it must stay a plain row: a module
  # header over a single file only repeats it.
  mdmod="$(printf '%s\n' "$md" | debar | grep -E '^ +Plane +\+' | tr -s ' ' | sed 's/^ *//')"
  [ "$mdmod" = "Plane +22 ~0 -0 +22" ] &&
    pass "md: the module row carries its subtotal" ||
    fail "md: the module row carries its subtotal — got [$mdmod]"
  has "b.ts" "$md" "md: a lone file keeps no module header"
  # Depth is indentation now, so the levels nest as deep as the names go and the
  # sub-module sits strictly inside its module.
  mdsub="$(printf '%s\n' "$md" | debar | grep -cE '^      Plane\.tile +\+')"
  [ "$mdsub" = "1" ] &&
    pass "md: the sub-module nests one level inside its module" ||
    fail "md: the sub-module nests one level inside its module — got $mdsub rows"
  # Both renderings nest the same, all the way down: a level only exists where it
  # splits something, so descending costs a handful of rows and names the
  # sub-module that took the charge. Only length still separates them.
  txsub="$(printf '%s\n' "$text" | debar | grep -cE '^      Plane\.tile +\+')"
  [ "$txsub" = "1" ] &&
    pass "text: nests the sub-module too" ||
    fail "text: nests the sub-module too — got $txsub rows"
  # A module row names the module and nothing else — the files are right under
  # it, so a count only repeated what is already on screen.
  modrow="$(printf '%s\n' "$text" | debar | grep -E '^    Plane +\+' | tr -s ' ' | sed 's/^ *//')"
  [ "$modrow" = "Plane +22 ~0 -0 +22" ] &&
    pass "text: the module row is its name and its subtotal" ||
    fail "text: the module row is its name and its subtotal — got [$modrow]"
  # The bar. Stripping every ASCII byte leaves it alone on the line, which needs
  # no multibyte-aware tool and so behaves the same under any locale.
  #
  # It is a share of the bucket total, not of the report: Plane is 22 of the 23
  # source lines, and 96% of an eight-column bar is seven columns and five
  # eighths. A report-wide denominator — 25 lines, tests and config folded in —
  # would draw a shorter bar on every row and still look deliberate.
  planebar="$(printf '%s\n' "$text" | grep -E '^    Plane ' | tr -d '\000-\177')"
  [ "$planebar" = "███████▋" ] &&
    pass "text: the bar is a share of its bucket" ||
    fail "text: the bar is a share of its bucket — got [$planebar]"
  # A row that made the report draws something: one line of 23 is 4%, well under
  # half a column, and it still has to be visible.
  leafbar="$(printf '%s\n' "$text" | grep -E '^        Plane\.tile\.label\.ts ' | tr -d '\000-\177')"
  [ "$leafbar" = "▍" ] &&
    pass "text: a small share still draws" ||
    fail "text: a small share still draws — got [$leafbar]"
  # The bucket row is the denominator every bar under it divides by, so it
  # carries none — a full column on every group would say only that a bucket is
  # all of itself. The interpunct is the row's own separator.
  bucketbar="$(printf '%s\n' "$text" | grep -E '^  source · ' | tr -d '\000-\177')"
  [ "$bucketbar" = "·" ] &&
    pass "text: the bucket row carries no bar" ||
    fail "text: the bucket row carries no bar — got [$bucketbar]"
  # The markdown fence is the same block, so the bars cross into the PR comment
  # unpainted — there they are the only visual encoding left.
  has "███████▋" "$md" "md: the fence carries the bars"

  # Each group is lifted off what precedes it, the first one included.
  case "$text" in
    *"touched"$'\n'$'\n'"  source · "*) pass "text: a blank line opens each group" ;;
    *) fail "text: a blank line opens each group" ;;
  esac
  # The group total is rendered on the same column grid as the rows it sums, so
  # a reader finds it directly above them and recognises it from the summary
  # table. A bare "+23 net" inline read as a fourth kind of number.
  has "source · 23 lines touched" "$text" "text: the group total heads its own rows"
  totals="$(printf '%s\n' "$text" | grep -E '^  source · ' | tr -s ' ' | sed 's/^ *//')"
  [ "$totals" = "source · 23 lines touched +23 ~0 -0 +23" ] &&
    pass "text: the group total repeats the summary row" ||
    fail "text: the group total repeats the summary row — got [$totals]"

  # And the rows at the group first level must add up to it. They are drawn
  # alike — same indent, same weight — which is a promise about arithmetic: a
  # module of three files and a file standing alone are both one term. Bolding
  # by kind instead of by depth broke this while still looking deliberate.
  lvl1=0
  for n in $(printf '%s\n' "$text" |
    awk '/^  source · /{g = 1; next} /^  (tests|config) · /{g = 0} g && /^    [^ ]/{print $NF}'); do
    lvl1=$((lvl1 + n))
  done
  [ "$lvl1" -eq 23 ] &&
    pass "text: the first-level rows sum to their group total" ||
    fail "text: the first-level rows sum to their group total — got $lvl1, want 23"

  # Ordering carries the whole point of the section: source before scaffolding,
  # and the heaviest entry first inside a group. A broken sort still reads as a
  # plausible list, so it has to be pinned.
  order="$(printf '%s\n' "$text" | grep -oE '^  (source|tests|config) · ' |
    awk '{print $1}' | tr '\n' ' ')"
  [ "$order" = "source tests config " ] &&
    pass "text: groups run source, tests, config" ||
    fail "text: groups run source, tests, config — got [$order]"

  first="$(printf '%s\n' "$text" | awk '/^  source · /{s = 1; next} s {print $1; exit}')"
  [ "$first" = "Plane" ] &&
    pass "text: the heaviest module leads its group" ||
    fail "text: the heaviest module leads its group — got [$first]"

  # One renderer, two settings: the markdown is the terminal report fenced. Only
  # colour and how many rows get dropped separate them, and this fixture is short
  # enough that neither applies — so the two blocks have to come out
  # byte-identical. That equality is what "one renderer" buys, and it is the
  # thing that silently rotted while there were two.
  fenced="$(printf '%s\n' "$md" |
    awk '/^```text$/{n++; next} /^```$/{if (n == 2) exit; next} n == 2')"
  plain="$(printf '%s\n' "$text" | awk '/ · [0-9]+ lines touched/{s = 1} s')"
  [ -n "$fenced" ] && pass "md: the fence carries the rollup" ||
    fail "md: the fence carries the rollup — empty"
  [ "$fenced" = "$plain" ] &&
    pass "md: the fence is the terminal rollup, verbatim" ||
    fail "md: the fence is the terminal rollup, verbatim"

  # --of measures a branch that is not checked out. The point of the flag is
  # that it answers about that branch and nothing else, so the assertions that
  # matter are the negative ones: none of the current checkout's files, and none
  # of its uncommitted work, may leak into the numbers.
  (
    cd "$tmp" || exit 1
    git checkout -q -b side main~1
    printf 'export const s = 1\nexport const s2 = 2\n' > Side.ts
    git add -A && git -c user.email=t@t -c user.name=t commit -q -m side
    git checkout -q main
    printf 'export const dirt = 1\n' > Dirty.ts
  )
  of="$(cd "$tmp" && bash "$script" --of side)"
  has "Side.ts" "$of" "--of: reports the named branch's files"
  case "$of" in
    *"Plane"*) fail "--of: leaked the checked-out branch's files" ;;
    *) pass "--of: ignores the checked-out branch" ;;
  esac
  case "$of" in
    *"Dirty.ts"*) fail "--of: leaked the checked-out branch's uncommitted work" ;;
    *) pass "--of: ignores the working tree it is not measuring" ;;
  esac
  has "…side" "$of" "--of: labels the range with the branch"
  # The flag parser takes them in any order, and refuses what it cannot honour.
  has "Side.ts" "$(cd "$tmp" && bash "$script" main~1 --of side --md)" \
    "--of: flags and the base parse in any order"
  (cd "$tmp" && bash "$script" --of nope > /dev/null 2>&1) &&
    fail "--of: rejects an unknown revision" ||
    pass "--of: rejects an unknown revision"

  # Weight is lines touched, not net: a rewrite is work. Ranking by net would
  # file this deletion below the one-line additions above it.
  heavy="$(mktemp -d)"
  (
    cd "$heavy" || exit 1
    git init -q . && git branch -M main
    for i in $(seq 40); do printf 'export const g%s = %s\n' "$i" "$i"; done > gone.ts
    printf 'export const k = 1\n' > kept.ts
    git add -A && git -c user.email=t@t -c user.name=t commit -q -m base
    rm gone.ts
    printf 'export const k = 1\nexport const k2 = 2\n' > kept.ts
    git add -A && git -c user.email=t@t -c user.name=t commit -q -m cut
  )
  cut="$(cd "$heavy" && bash "$script" main~1)"
  rm -rf "$heavy"
  case "$cut" in
    *'gone.ts'*'kept.ts'*) pass "text: the deletion outranks the addition" ;;
    *) fail "text: the deletion outranks the addition" ;;
  esac

  # A branch that only touched excluded files has a total and nothing to break
  # down, and both halves have to be said. This used to print "no changes" over a
  # diff the PR page counts at +30, which is the exact contradiction the total
  # now exists to close.
  prose="$(mktemp -d)"
  (
    cd "$prose" || exit 1
    git init -q . && git branch -M main
    git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
    for i in $(seq 30); do printf 'prose %s\n' "$i"; done > README.md
    git add -A && git -c user.email=t@t -c user.name=t commit -q -m docs
  )
  only="$(cd "$prose" && bash "$script" main~1)"
  onlymd="$(cd "$prose" && bash "$script" --md main~1)"
  rm -rf "$prose"
  has "1 file changed, 30 insertions(+) · as GitHub counts it" "$only" \
    "text: an all-excluded diff still reports its total"
  has "nothing counted" "$only" "text: and says nothing was counted"
  has "1 file changed, 30 insertions(+) · as GitHub counts it" "$onlymd" \
    "md: an all-excluded diff still reports its total"
  case "$only" in
    *"no changes"*) fail "text: an all-excluded diff read as no changes" ;;
    *) pass "text: an all-excluded diff is not 'no changes'" ;;
  esac

  # Depth is whatever the names carry — the rollup consumes one dot segment per
  # level and knows no ceiling. Two traps live here. Files whose segments are
  # identical (same name, different extension) group together at every level
  # forever, so the descent has to notice it consumed nothing and stop. And the
  # markdown used to cap at two levels because a table cell cannot be indented;
  # inside a fence it must not.
  deep="$(mktemp -d)"
  (
    cd "$deep" || exit 1
    git init -q . && git branch -M main
    git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
    printf 'export const a = 1\n' > P.q.r.one.ts
    printf 'export const b = 1\n' > P.q.r.two.ts
    printf 'export const c = 1\n' > P.q.s.ts
    printf 'export const d = 1\n' > P.z.ts
    # Same segments, different extension: the pair that never splits.
    printf 'export const e = 1\n' > P.q.r.one.tsx
    # A chain: C holds only C.d, which holds only C.d.e. Three headers carrying
    # one subtotal say it once.
    printf 'export const f = 1\n' > C.d.e.one.ts
    printf 'export const g = 1\n' > C.d.e.two.ts
    git add -A && git -c user.email=t@t -c user.name=t commit -q -m deep
  )
  nest="$(cd "$deep" && bash "$script" --md main~1)"
  capped="$(cd "$deep" && bash "$script" --md --depth 2 main~1)"
  (cd "$deep" && bash "$script" --depth x main~1 > /dev/null 2>&1) &&
    depth_rejects=0 || depth_rejects=1
  rm -rf "$deep"
  for want in '    P ' '      P.q ' '        P.q.r ' '          P.q.r.one ' \
    '            P.q.r.one.ts '; do
    case "$nest" in
      *"$want"*) pass "md: nests at [${want# }]" ;;
      *) fail "md: nests at [${want# }]" ;;
    esac
  done
  # Both members of the unsplittable pair are listed under the last segment they
  # share, at the same depth, rather than recursed on until the stack gives out.
  twins="$(printf '%s\n' "$nest" | debar | grep -cE '^            P\.q\.r\.one\.tsx? +\+')"
  [ "$twins" = "2" ] &&
    pass "md: identical segments stop the descent and list their files" ||
    fail "md: identical segments stop the descent and list their files — got $twins rows"

  # The chain collapses: one header at the first level, naming the deepest link,
  # and no intermediate row repeating its numbers.
  # --depth caps the descent. At 2 the fourth level cannot exist, and the rows
  # that would have nested there are listed flat under the last level that fits.
  case "$capped" in
    *'          P.q.r.one '*) fail "--depth: 2 still nested a fourth level" ;;
    *) pass "--depth: caps the descent" ;;
  esac
  has "        P.q.r.one.ts " "$capped" "--depth: the capped rows list flat"
  [ "$depth_rejects" = "1" ] &&
    pass "--depth: rejects what is not a whole number" ||
    fail "--depth: rejects what is not a whole number"

  # A repo says what else is not product code in `.claude/branchstat.json`, and
  # the patterns have to reach both dialects: git's, or the total disagrees with
  # the buckets, and cloc's, or the breakdown counts what the repo disowned.
  cfg="$(mktemp -d)"
  (
    cd "$cfg" || exit 1
    git init -q . && git branch -M main
    git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
    mkdir -p .claude generated
    printf '{ "exclude": ["generated/"] }\n' > .claude/branchstat.json
    for i in $(seq 30); do printf 'export const g%s = %s\n' "$i" "$i"; done > generated/api.ts
    printf 'export const a = 1\n' > App.ts
    git add -A && git -c user.email=t@t -c user.name=t commit -q -m gen
  )
  cfgout="$(cd "$cfg" && bash "$script" main~1)"
  rm -rf "$cfg"
  has "App.ts" "$cfgout" "config: the repo's own code still counts"
  case "$cfgout" in
    *'generated/api.ts'*) fail "config: an excluded tree reached the breakdown" ;;
    *) pass "config: .claude/branchstat.json keeps a tree out of the breakdown" ;;
  esac
  has "32 insertions" "$cfgout" "config: the total still counts what it excluded"

  chain="$(printf '%s\n' "$nest" | debar | grep -cE '^    C\.d\.e +\+')"
  links="$(printf '%s\n' "$nest" | debar | grep -cE '^ +C(\.d)? +\+')"
  [ "$chain" = "1" ] && [ "$links" = "0" ] &&
    pass "md: a chain of one-child groups collapses onto its last link" ||
    fail "md: a chain of one-child groups collapses onto its last link — got $chain headers, $links links"
else
  echo "  (cloc absent — renderer smoke tests skipped)"
fi

[ "$fails" -eq 0 ] && echo "branchstat ✓" || { echo "$fails failed ✗"; exit 1; }
