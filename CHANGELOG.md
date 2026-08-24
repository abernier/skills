# @abernier/skills

## 0.9.0

### Minor Changes

- [#41](https://github.com/abernier/skills/pull/41) [`553dacb`](https://github.com/abernier/skills/commit/553dacb3dc6dd18f62160a90cde60969c5f168e2) Thanks [@abernier](https://github.com/abernier)! - `fallow@fallow-skills` becomes a dependency, so installing this plugin installs
  the dead-code analyser `module-layout` hands the import graph to.
  
  Cross-marketplace dependencies are blocked unless the root marketplace allows
  them, so `fallow-skills` joins `allowCrossMarketplaceDependenciesOn`. Add that
  marketplace once — `/plugin marketplace add fallow-rs/fallow-skills` — and the
  dependency resolves itself.

- [#29](https://github.com/abernier/skills/pull/29) [`207b9fd`](https://github.com/abernier/skills/commit/207b9fd5643d9f36942d18d8db2aa8afc2399e4a) Thanks [@abernier](https://github.com/abernier)! - The doctrine becomes skills.
  
  Eight skills — `doc-routing`, `module-layout`, `typescript-conventions`,
  `react-conventions`, `test-conventions`, `visual-debugging`, `gates`, `pre-1-0`
  — carrying the conventions an `AGENTS.md` used to spell out in full.
  
  That file kept the rule and the reason together, and paid for both on every task,
  in every repo that copied it. Split, a rule lives here and loads when the work
  actually touches it. A consuming repo keeps no copy at all — not the reason, not
  the mechanism, not a one-line summary — because an echo is a second source of
  truth that drifts, in the one file loaded on every task. What was three hundred
  lines of always-on prose becomes a table of eight names.
  
  The bar for staying in the consumer is what a skill cannot know: the charter
  governing edits to that very file, which has to be in force at the moment the
  file is edited; what the repo does differently; and its own names and documents.
  
  Nothing here names a repo. A product stance, a schema shape, a gate's real
  command name, the way one app versions its store: those stay with whoever owns
  them.
  
  Nothing here re-states `mattpocock-skills` either. `doc-routing` hands the shape
  of a decision record to `domain-modeling` and adds only the reason agentic work
  needs on top — an approach tried and rejected, unrecorded, gets re-proposed every
  few months. `module-layout` hands the deep-module vocabulary to `codebase-design`
  and keeps the file-organisation half. Neither names a path, so a repo that never
  ran that setup still routes correctly.

- [#42](https://github.com/abernier/skills/pull/42) [`eb00f49`](https://github.com/abernier/skills/commit/eb00f49ddf9236655a050ed43a7c007bc953f500) Thanks [@abernier](https://github.com/abernier)! - A tracerbench run with no mark to compare no longer reads as a pass.
  
  `v0.8.0` fixed this for the profiler and claimed tracerbench never had it. It
  did. Observed twice in the wild — `tilt` and `sizematters` — on `lgtm-perf` runs
  that exited 0 and printed `tracerbench : ✅ pass`:
  
  ```
  ❌ The control leg exited 1 — its output above says why.
  ⏳ Comparing results…
  Mark                          Control     Experiment      Delta
  Total                             0ms            0ms       0.0%
  ✅ Total regression 0.0% is within threshold of +25%
  ⚠️  Step drift: 0 compared, 14 only on experiment, 0 only on control, 0 bailed on one side.
  ```
  
  `v0.8.0` reasoned that a missing report takes the comparer down and `set -e`
  takes the script with it. The report is not missing: Playwright's JSON reporter
  writes one even when its `webServer` never starts — `suites: []`, one error. So
  the comparer read a valid file, found nothing in common with the experiment,
  summed an empty set to `0ms` against `0ms`, and called that within threshold.
  `Step drift` reported `0 compared` and framed it as a benign test-id rename.
  
  **This will turn runs red that used to be green**, and that is the point: the
  run that goes red is the one that compared nothing. Summing no marks gives
  `+0.0%`, which is not a measurement of "no regression" — it is the absence of a
  measurement.
  
  - The gate is the size of the compared intersection, not the exit status of a
    leg. A leg can fail an assertion and still have timed every mark; voiding a
    real measurement over that would be a different bug. Zero rows compared is
    reported as `NO DATA`, on the console and in the PR comment, and exits
    non-zero — with no threshold declared too. An absent width says "do not judge
    my numbers"; it never said "do not tell me the bench did not run".
  - A mark missing from one side is still drift, and still compared as before.
    The three shapes that are not — a side that timed nothing at all, two sides
    sharing no mark, and every shared mark bailing — are named in the verdict.
  - A leg starts against a free port. `vite preview` binds `--strictPort`, and the
    ports only came down in the exit trap, after the comparison — so a leg could
    meet a port a previous run still held and die on
    `http://localhost:4200 is already used`. That is the collision that produced
    the false green. The same sweep now runs immediately before each leg binds.
  - `tracerbench.sh` no longer dies at the comparer under `set -e`, so a red run
    still emits the footer naming the commit its numbers belong to.
  - The profiler's experiment-only comment no longer reads `Verdict: ✅ PASS`
    under its own `❌ No baseline — nothing was compared` banner. Nothing was
    gated wrongly there; the comment simply contradicted the exit code.

## 0.8.0

### Minor Changes

- [#30](https://github.com/abernier/skills/pull/30) [`38a8093`](https://github.com/abernier/skills/commit/38a80936e085cb3867baa94c26cb4b6905384c65) Thanks [@abernier](https://github.com/abernier)! - A profiler run that measured only one side no longer reads as a pass.
  
  When the control leg failed to produce a report, `profiler.sh` diffed the
  experiment report against itself — every row `0.0% ok` — printed
  `✅ PASS — 0 component blockers` and exited 0, so `lgtm-perf` reported
  `profiler : ✅ pass`. Two repos verified a release against that green. The
  missing *experiment* report took the same route: "cannot proceed", exit 0.
  
  **This will turn runs red that used to be green**, and that is the point: the
  run that goes red is the one that never compared anything. Two shapes of it —
  a control branch that predates the harness, and a control whose installed
  `@abernier/skills` is older than the config copied forward into its worktree
  (`ERR_PACKAGE_PATH_NOT_EXPORTED` at config load). Both exit non-zero now.
  
  - A side that produced no report exits non-zero, in strict mode and in soft
    mode alike. Soft is about *regressions* being advisory; it was never about a
    bench that did not run. CI is unaffected in shape: the reusable `perf.yml`
    already runs the bench under `continue-on-error` unless the caller asked for
    `strict`, so a soft run still posts its comment and stays green.
  - The experiment-only summary is still emitted — it is the deliverable on the
    PR that introduces the bench to a repo — but its banner now says the run is
    not a pass, and that the deltas are this run diffed against itself.
  - Each leg's exit status is reported where it happens, instead of being
    inferred pages later from a missing file. Both benches; `tracerbench.sh`
    never had the false green (a missing report takes its comparer down, and
    `set -e` with it) but reported the failure just as late.
    
    **Correction.** That parenthesis was wrong, and so was the claim it
    supported. The report is not missing: Playwright's JSON reporter writes one
    even when its `webServer` never starts. `tracerbench.sh` had the same false
    green, from the same release, and it is fixed in 0.9.0.
  - Under `--strict`, a regression no longer kills `profiler.sh` before the
    footer naming the commit the numbers belong to.

### Patch Changes

- [#38](https://github.com/abernier/skills/pull/38) [`5dce58c`](https://github.com/abernier/skills/commit/5dce58c775ae0e55d6333cf9291003e0e2e9840a) Thanks [@abernier](https://github.com/abernier)! - The release commit no longer rewrites the version pin inside
  `.github/workflows/perf.yml`.
  
  Pushing a change to a workflow file needs a `workflows` scope the Actions token
  does not have, so a pin there does not go stale — it makes every release push
  fail outright. The example in that file now reads `@vX.Y.Z`, and says why. The
  README's install line still carries a real version and is still rewritten.

- [#32](https://github.com/abernier/skills/pull/32) [`a603e4c`](https://github.com/abernier/skills/commit/a603e4c9c47ec942c24538b5add502a8c8cc1c12) Thanks [@abernier](https://github.com/abernier)! - The control worktree now runs the experiment's copy of this package.
  
  `profiler.sh` copies the experiment's `e2e/profiler.spec.ts` and
  `playwright.profiler.config.ts` into the control worktree so both sides are
  measured the same way. When the two lockfiles differ, the worktree installs the
  control's own dependency tree — which pins whatever version of
  `@abernier/skills` the control branch pinned, or none at all — and those two
  files were then run against it. Both halves broke in the wild:
  `ERR_PACKAGE_PATH_NOT_EXPORTED` where the base predated a subpath, and
  `Cannot find package '@abernier/skills'` where the base predated the package.
  Neither says anything about the PR: the branch that adds a bench can never have
  a baseline that already ran it.
  
  The control supplies the application; the experiment supplies the apparatus.
  This package is now laid over the installed tree after that install, so a PR
  that adds the bench — or reaches for a subpath its base predates — still gets a
  real comparison instead of a one-sided summary.
  
  - Copied, not symlinked. Node resolves a symlinked package from its real
    location, so through a link this package's `@playwright/test` — its only peer
    dependency — would come from the experiment's tree while the control's own
    binary drives the run. A copy resolves upward through the worktree's
    `node_modules`, which is the control's Playwright, which is the one running.
  - The overlay is the only thing swapped. Everything else in the worktree stays
    the control's, including its Playwright, its vite and its React.
  - A failed overlay exits non-zero on the spot rather than benching the control
    against a different harness.
  - The fast path is untouched: when the lockfiles match, the worktree symlinks
    the experiment's `node_modules` and already had the experiment's copy.
  - `tracerbench.sh` needs none of this. Its control worktree only builds — both
    measurement legs run from the repo root, against the root's config, spec and
    `node_modules`.

## 0.7.0

### Minor Changes

- [#27](https://github.com/abernier/skills/pull/27) [`2092d85`](https://github.com/abernier/skills/commit/2092d85291abb125832daf7b21ce5e2cb6867e0f) Thanks [@abernier](https://github.com/abernier)! - The shipped `.mjs` modules are typechecked, and their `.d.mts` siblings
  are generated from their JSDoc rather than hand-written beside them.
  
  `tsconfig.build.json` globs `scripts/*.mjs`, checks them under
  `allowJs`/`checkJs`, and emits the declarations — committed, because consumers
  install from a git tag and nothing builds on their side. `pnpm run types:emit`
  regenerates them; `pnpm run lgtm` fails if regenerating would change anything.
  
  Repaired along the way, because a generated declaration is only as good as the
  JSDoc behind it:
  
  - `gestures.mjs` had an orphaned JSDoc block, leaving `wheel` and `wheelBurst`
    undocumented and every parameter of `wheel`, `wheelBurst` and `notch`
    implicitly `any`.
  - `bench.playwright.mjs` typed its `webServer` escape hatch as `object`, which
    erased Playwright's own field types. It is
    `Partial<NonNullable<PlaywrightTestConfig["webServer"]>>` again, and the eight
    environment variables it documents now travel with the declaration.
  - `bench.config.mjs` declared `BenchConfig` only in the file the generator
    overwrites. It is a `@typedef` in the module now, so the type a consumer sees
    is a projection of the reader rather than a claim about it.

- [#27](https://github.com/abernier/skills/pull/27) [`2092d85`](https://github.com/abernier/skills/commit/2092d85291abb125832daf7b21ce5e2cb6867e0f) Thanks [@abernier](https://github.com/abernier)! - One meaning per separator in `scripts/`. A dot separates scopes
  (`feature.subfeature.ext`), a hyphen joins words inside one name, and no file
  carries a leading underscore. `bench.*` is what the two benches share;
  `tracerbench.*` and `profiler.*` belong to one of them.
  
  Public command names are unchanged — `profiler-compare` is still
  `profiler-compare`, even though its file is now `profiler.compare.sh`.
  
  BREAKING: the `./vite` export subpath is now `./bench-tests`, with no alias. The
  subpath said "vite", the file said "vite", the export is `benchTests()`, the
  plugin id is `@abernier/skills:bench-tests` and the vitest project is `"bench"` —
  four names for one thing, folded into one.
  
  ```diff
  -import { benchTests } from "@abernier/skills/vite";
  +import { benchTests } from "@abernier/skills/bench-tests";
  ```

- [#27](https://github.com/abernier/skills/pull/27) [`2092d85`](https://github.com/abernier/skills/commit/2092d85291abb125832daf7b21ce5e2cb6867e0f) Thanks [@abernier](https://github.com/abernier)! - `bench.json` has one reader, and the three `.ts` bins have one launcher.
  
  `scripts/bench.config.mjs` is now the only thing that opens `bench.json`.
  `profiler.compare.ts` used to open it a second time behind `bench.config.sh`'s
  back, with its own defaults written again in a second language — `["src"]` for
  `sourceRoots`, `"src/components/ui/"` for `shadcnUiRoot`, which are one
  consumer's layout, in a file nobody would think to check. The defaults now live
  in one place, `bench.config.sh` is a shell door onto that file, and its
  `bench_config` / `bench_config_list` are unchanged.
  
  A bench also spends fewer processes on its config: the door asks `node` once
  when it is sourced and answers every key from that in pure bash, where
  `tracerbench.sh` used to pay a `node` start per key.
  
  `scripts/bench.launch.sh` holds what `tracerbench.compare.sh`,
  `profiler.compare.sh` and `profiler.aggregate.sh` each carried a copy of — the
  `GIT_DIR` scrub, the `realpath` on `BASH_SOURCE`, the measured repo's own `tsx`,
  and the bin name the program prints in its usage. The three files stay, because
  `bin` needs three paths and pnpm execs the file rather than a symlink named
  after the command, so `$0` cannot say which program it is. Each is now one line.
  
  Nothing a consumer types changes: the same six bins, at the same paths, with the
  same usage strings.

- [#27](https://github.com/abernier/skills/pull/27) [`2092d85`](https://github.com/abernier/skills/commit/2092d85291abb125832daf7b21ce5e2cb6867e0f) Thanks [@abernier](https://github.com/abernier)! - The Playwright wiring becomes an interface: `@abernier/skills/playwright`
  
  `tracerbenchConfig()` and `profilerConfig()` build the two configs the benches
  run under, so the eight environment variables the harness exports — `TB_PORT`,
  `TB_DIST`, `TB_OUTPUT_DIR`, `TB_COUNTERS`, `PLAYWRIGHT_JSON_OUTPUT_FILE`,
  `PROFILER_PORT`, `PROFILER_COMMITS`, `PROFILER_SCAN_BUNDLE` — are written down
  in the package that sets them instead of being rediscovered by each consumer.
  
  A consumer passes what only its repo knows: the dev-server `command`, and a
  `timeout` when two minutes is not enough. Port and base URL derivation,
  `testDir`, `testMatch`, `workers`, `outputDir`, the `list` + `json` reporter
  pair, `use.trace`, `webServer.url` / `reuseExistingServer` and the profiler's
  `globalSetup: "@abernier/skills/profiler-scan"` all move behind it.
  
  BREAKING: `@playwright/test` is now a peer dependency, `>=1.49`. The configs are
  loaded by the consumer's Playwright and must use its copy, so a repo that has
  none — or an older one — installs or upgrades it. Nothing else about a
  hand-written config stops working; the builders are there to replace it, not to
  require replacing it.

- [#27](https://github.com/abernier/skills/pull/27) [`2092d85`](https://github.com/abernier/skills/commit/2092d85291abb125832daf7b21ce5e2cb6867e0f) Thanks [@abernier](https://github.com/abernier)! - `files` lists what ships instead of subtracting three things from `scripts/`.
  Nine test files used to land in every consumer's `node_modules`, one for every
  rule this package checks about itself. Eight of them travelled for nothing.
  
  BREAKING: the ninth was never a test of this package, and it has an honest name
  now. `scripts/profiler.compare.test.ts` ended in a block that read your
  `bench.json`, walked the `sourceRoots` it declares, and gated on whatever
  first-party component it found — the check that goes red when a source tree
  moved and the config did not. That block is `scripts/bench.conformance.test.ts`,
  and `profiler.compare.test.ts` stays here with the rest of the suite.
  
  `benchTests()` follows the rename, so a `vitest.config.ts` using the plugin
  needs no change:
  
  ```ts
  import { benchTests } from "@abernier/skills/bench-tests";
  
  export default defineConfig({ plugins: [benchTests()] });
  ```
  
  A config that wired the old path by hand has to move:
  
  ```diff
  -  include: ["node_modules/@abernier/skills/scripts/profiler.compare.test.ts"],
  +  include: ["node_modules/@abernier/skills/scripts/bench.conformance.test.ts"],
  ```

- [#27](https://github.com/abernier/skills/pull/27) [`2092d85`](https://github.com/abernier/skills/commit/2092d85291abb125832daf7b21ce5e2cb6867e0f) Thanks [@abernier](https://github.com/abernier)! - New types-only subpath `@abernier/skills/bench-types`, exporting the bench
  harness's wire contract: `RenderCause`, `RenderRecord`, `CommitRecord` and
  `PerfIdStats`.
  
  Consuming `e2e/profiler.spec.ts` files re-declared these shapes by hand,
  because a value import of a `.ts` file under `node_modules` dies with
  "Stripping types is currently unsupported for files under node_modules".
  `import type` never reaches Node, so a spec can now read the shapes from the
  package instead of copying them:
  
  ```ts
  import type { CommitRecord, PerfIdStats } from "@abernier/skills/bench-types";
  ```
  
  The recorder that produces them (`profiler.scan.injected.ts`), the aggregator
  that folds them and the comparer that diffs them all read the same file now, so
  a drift in the recorder's output has one declaration to break instead of five to
  fall out of sync.

## 0.6.1

### Patch Changes

- [#25](https://github.com/abernier/skills/pull/25) [`5ee8957`](https://github.com/abernier/skills/commit/5ee8957c814ae26315200ed14420aad6a2c3663e) Thanks [@abernier](https://github.com/abernier)! - `wheel` fires at the point it was given.
  
  The two paths disagreed about what `x, y` meant. The dispatched path — the one a
  modifier selects — aims itself through `elementFromPoint`, so it always landed on
  the point. The trusted path is `page.mouse.wheel`, which fires wherever the
  pointer already happens to be, so it ignored both coordinates entirely. One
  signature, two meanings, chosen by a flag the caller was thinking about for an
  unrelated reason.
  
  The pointer now goes to the point on both paths, once per gesture. `wheelBurst`
  still moves once rather than once per tick: a gesture is one movement, and an app
  with a `mousemove` handler should not have to process one per notch — which for a
  bench would be measuring the harness rather than the app.

## 0.6.0

### Minor Changes

- [#22](https://github.com/abernier/skills/pull/22) [`50f51d2`](https://github.com/abernier/skills/commit/50f51d27a224759a8dec639d181b0d80673a3ace) Thanks [@abernier](https://github.com/abernier)! - The profiler's render-cause recorder and the Playwright `globalSetup` that
  bundles it now ship here, at `@abernier/skills/profiler-scan`.
  
  Both files were already the plugin's in everything but location. `profiler.sh`
  hardcoded both names, and one of its two `cp`s into the control worktree was
  unconditional — a consumer that deleted either one broke the bench under `set
  -euo pipefail`. The two repos running this harness carried them byte-identically:
  the recorder to the byte, the setup down to a single word in a single comment.
  A file every consumer must have, at a path the harness already knows, is not the
  consumer's file.
  
  They ship in different shapes, because they are loaded in different ways.
  `profiler-scan.setup.mjs` is imported — Playwright loads it as `globalSetup`, and
  a spec reads `SCAN_BUNDLE_PATH` off it — so it is `.mjs` with
  `profiler-scan.setup.d.mts` beside it, the same reason `gestures.mjs` is: Node
  strips types in first-party files only, and Playwright does not transform
  `node_modules`. `profiler-scan.injected.ts` is never imported by anything;
  esbuild reads it as an entry point and transpiles it itself, so it stays
  TypeScript and keeps its types.
  
  Both now resolve their dependencies from the repo being measured rather than
  from this package — `esbuild` through a `require` rooted at that repo's
  `package.json`, `bippy` through esbuild's `nodePaths` — because under pnpm this
  package's real path is a store directory whose siblings are its own
  dependencies. The bundle's default location moved for the same reason: it lands
  under the measured repo's `profiler-results/`, never beside the package. And
  `profiler.sh` no longer copies the setup into the control worktree: that worktree
  resolves the package through the `node_modules` it is already given, exactly as
  it does for `@abernier/skills/gestures`.
  
  `$PROFILER_SCAN_BUNDLE` is unchanged and still the escape hatch. Pointed at a
  file that already exists, `globalSetup` builds nothing and trusts it — which is
  how `profiler` hands the experiment and the control one byte-identical recorder,
  and how a repo that needs a recorder of its own swaps one in.
  
  BREAKING: delete `e2e/profiler-scan.setup.ts` and `e2e/profiler-scan.injected.ts`,
  point `globalSetup` at `"@abernier/skills/profiler-scan"` in
  `playwright.profiler.config.ts`, and import `SCAN_BUNDLE_PATH` from there in your
  spec. Keep `bippy` and `esbuild` as your own devDependencies — the bundle is
  still built from your tree. No migration.

- [#20](https://github.com/abernier/skills/pull/20) [`49eacf0`](https://github.com/abernier/skills/commit/49eacf0e68c737c90e7346028d0cc7543a29af44) Thanks [@abernier](https://github.com/abernier)! - The human-like Playwright gestures a bench spec is written with now ship here,
  importable from `@abernier/skills/gestures`.
  
  Both consumers carried the same `e2e/gestures.ts`, and the first two thirds of
  it were the same bytes on either side: a `smoothMove` that walks a line one
  event at a time, and a `smoothDrag` that holds the button down for it. Neither
  touches the app it lives in — that is the point of the file, so that
  `profiler.sh` can put it next to the spec in a control worktree — which makes it
  harness code sitting in two repos, drifting.
  
  The wheel arrived in three shapes: a `wheel` firing one event with modifiers, a
  `smoothZoom` firing eight with `ctrlKey` hardcoded, a `smoothPan` looping
  `page.mouse.wheel`. They collapse into two:
  
  ```ts
  import { smoothDrag, wheel, wheelBurst } from "@abernier/skills/gestures";
  
  await smoothDrag(page, 200, 300, 600, 300, { steps: 40, stepDelay: 8 });
  await wheelBurst(page, 400, 300, { deltaY: -400, ctrlKey: true }); // zoom
  await wheelBurst(page, 400, 300, { deltaX: 300, ticks: 10, tickDelay: 25 }); // pan
  ```
  
  `wheelBurst` is `wheel` n times at a point, and its deltas are the gesture's
  totals rather than a per-notch amount — a hand rolls a wheel a distance. `wheel`
  stays on `page.mouse.wheel` unmodified, so an unmodified wheel still scrolls the
  page like a real notch, and hand-dispatches only when `ctrlKey` or `shiftKey`
  are asked for, which Playwright's wheel drops. Both paths wait until the page
  has the event, so the line after an `await` can assert on what it did;
  Playwright's own wheel resolves a frame before that, which is a race in every
  spec that has ever read a listener's log straight after one.
  
  They ship as `.mjs` with types beside them. A `.ts` file under `node_modules`
  throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` the moment a spec imports
  it — the rule `profiler-aggregate.ts` already states from the other side — and
  Playwright transforms no `node_modules` either. The package still has no build
  step.
  
  `profiler.sh` stops copying `e2e/gestures.ts` into the control worktree. The
  worktree resolves the package through the `node_modules` it is already given,
  the same one its `playwright` binary comes from. A repo whose gestures really
  are its app's — reaching for its state, building its scene — keeps that file and
  names it in `controlWorktreeCopy`, like everything else a spec imports.

- [#21](https://github.com/abernier/skills/pull/21) [`b938e64`](https://github.com/abernier/skills/commit/b938e64a62f19ecb4d9f26f79a5e01e9740d5922) Thanks [@abernier](https://github.com/abernier)! - The bench pipeline is now a reusable workflow, `.github/workflows/perf.yml`, so
  a repo that wants both benches on its PRs calls it instead of copying it.
  
  The two repos running this harness carried a `perf.yml` of 173 and 153 lines
  that were the same file twice: the same concurrency group, the same trigger
  types, the same draft gate, the same stale-marker, the same "ensure the comment
  file exists" heredoc, the same sticky comment, the same artifact upload. What
  genuinely differed was four values — whether a regression reddens the PR, the
  timeout, the artifact retention, and the draft gate — and one thing that cannot
  move, the `paths:` filter, because which files are worth a bench run is the one
  question only the repo can answer. Everything else was drift waiting to happen,
  and it had already happened: the action pins were two major versions apart, and
  one copy still guarded three steps on `github.event_name == 'pull_request'`
  under a trigger that is already pull-request-only.
  
  So the values that actually diverge are `inputs` — `strict`, `timeout-minutes`
  and `node-version-file` — and the caller keeps `on:`, its `paths:` and its
  `concurrency:` group. That last one stays behind on purpose rather than by
  omission: `github.workflow` inside a called workflow resolves to the *caller's*
  workflow name, so a group built from it reads correctly only where the trigger
  it cancels lives.
  
  The two benches now run as two legs of one matrix instead of two hand-copied
  jobs. Drift between two copies of a pipeline is the bug this change exists to
  stop, and it is no less a bug inside one file than across two repositories —
  the two jobs it replaces had already diverged in their comments.
  
  `mark-bench-comment-stale.cjs` moves here too, byte-identical in both repos and
  therefore never theirs. The workflow checks this repository out at
  `github.job_workflow_sha` — the commit the workflow file itself was read from,
  so the workflow and the script it runs can never be two versions of each other —
  and requires it from there, the same way `branchstat.yml` runs
  `scripts/branchstat.sh`. It is CI-only and stays out of `package.json`'s
  `files`: nothing ever resolves it from `node_modules`.
  
  The workflow installs pnpm, Node and the Playwright browsers itself rather than
  calling a `./.github/actions/setup` composite action in the caller. It has no
  choice — a relative `uses:` inside a called workflow resolves against whatever
  is checked out in the workspace, which is the caller's repo — and it is also
  what finally puts the action pins in one place. A caller now provides a
  `.nvmrc`, a `pnpm-lock.yaml` and the `tracerbench` / `profiler` bins, and
  nothing else; `node-version-file` is an input for a repo that pins Node
  somewhere other than `.nvmrc`.

## 0.5.0

### Minor Changes

- [#13](https://github.com/abernier/skills/pull/13) [`2c49b62`](https://github.com/abernier/skills/commit/2c49b62be2593955b678b8101f4deb268a478172) Thanks [@abernier](https://github.com/abernier)! - The bench harness reads its per-repo config from `bench.json` at the repository
  root, not from `.claude/bench.json`.
  
  `.claude/` is Claude Code's own directory, and this file was never agent state:
  it is committed repo config, read by six plain node/bash bins that run in CI
  with no Claude in the loop. An un-namespaced filename sitting inside a
  platform's directory reads as a native feature of that platform, which this is
  not. The root of a repo names the thing rather than its provider — `tsconfig.json`,
  `vite.config.ts` — so the file is plain `bench.json`, namespaced by neither the
  plugin nor the vendor.
  
  Nothing else changes: the same keys, the same defaults, and a single-package
  repo still needs no config file at all. `branchstat` now buckets a root
  `bench.json` as config, which it did for the old path already.
  
  BREAKING: move `.claude/bench.json` to `bench.json` at your repository root.
  There is no fallback to the old path — left where it is, the file is ignored and
  every bench silently runs on the defaults.

- [#19](https://github.com/abernier/skills/pull/19) [`54e7851`](https://github.com/abernier/skills/commit/54e78512e80e8fe52a3695c4788df6d9d3b34649) Thanks [@abernier](https://github.com/abernier)! - A tracerbench threshold that `bench.json` does not declare is no longer a 20%
  gate. It is no gate at all.
  
  A gate width is a calibration of one repo on one machine — `sizematters` runs at
  20/10, `tilt` had to override to 50/30 — so there is no number this harness can
  pick that is right for a repo it has never measured. The old defaults were one
  consumer's calibration reaching every other, and a third repo inherited a 20%
  bar it never chose and could not see. It also contradicted the rule
  `_bench-config.sh` states in its own header: an absent key adds nothing to a
  mechanism rather than turning one on.
  
  So `thresholds.tracerbenchMs`, `thresholds.tracerbenchFrames`,
  `thresholds.localTracerbenchMs` and `thresholds.localTracerbenchFrames` all
  default to nothing. The bench still builds both sides, still measures, still
  writes its comment with every number and delta — it exits 0 without judging, and
  says so: `📊 **NO GATE** — … measured, not judged: no threshold is configured`,
  never a green tick that reads as a bar cleared. `tracerbench.sh` passes
  `--threshold` and `--frames-threshold` to the comparer only when the config named
  a width, and prints what actually gates the run instead of an empty percentage.
  
  The cascade survives. `tracerbenchFrames` still borrows the ms width when it is
  the only one declared, so one number gates both signals; declared alone it gates
  frames alone, and the wall-clock total is reported as `ungated` rather than as
  passing.
  
  `lgtm-perf.sh` also stops claiming its local widths are "half of the benches'
  own". The profiler's `--component-threshold 20` is what both founding repos
  calibrated to against a bench default of 30 — a third tighter, not half — and it
  stays 20. Only the sentence was wrong.
  
  BREAKING: an absent threshold in `bench.json` no longer means a 20% gate, it
  means no gate. Add `"thresholds": { "tracerbenchMs": 20 }` to keep the gate you
  had. No migration.

- [#15](https://github.com/abernier/skills/pull/15) [`31d2845`](https://github.com/abernier/skills/commit/31d2845de8554278133ce8f51334d4a891ed4ab2) Thanks [@abernier](https://github.com/abernier)! - `branchstat` reads its per-repo exclude list from `branchstat.json` at the
  repository root, not from `.claude/branchstat.json`.
  
  `.claude/` is Claude Code's own directory, and the convention for plugin config
  there — `.claude/<plugin>.local.md` — is per-user, gitignored state. This file is
  the opposite: it is tracked, and it states repo-wide facts about what is not
  product code, shared by everyone working on the repo. The root of a repo names
  the thing rather than its provider — `tsconfig.json`, `vite.config.ts` — so the
  file is plain `branchstat.json`, namespaced by neither the plugin nor the vendor.
  
  Nothing else changes: the same `exclude` key, the same defaults, and a repo that
  needs no extra excludes still needs no config file at all. `branchstat` buckets a
  root `branchstat.json` as config, which it did for the old path already.
  
  BREAKING: move `.claude/branchstat.json` to `branchstat.json` at your repository
  root. There is no fallback to the old path — left where it is, the file is
  ignored and the breakdown silently runs on the defaults.

### Patch Changes

- [#17](https://github.com/abernier/skills/pull/17) [`c4ba95e`](https://github.com/abernier/skills/commit/c4ba95e0db4fa82de2812135f9909308d2788f75) Thanks [@abernier](https://github.com/abernier)! - `branchstat.sh` drops every variable `git rev-parse --local-env-vars` names
  before it resolves the repository, so an inherited `GIT_DIR` can no longer
  redirect the report at another repo.
  
  Git reads `GIT_DIR` and friends out of the environment and lets them win over
  `cwd` — and over `-C`, so no git call in the script could defend itself against
  one. A git hook exports them, which is how a local `/branchstat` run inherits
  one. With `GIT_DIR` set, `ROOT_DIR`, the base and the range were all read out of
  the hook's repository rather than the one the caller stands in: wrong base
  commit, wrong file count, wrong top module. Nothing failed while it happened —
  a report on the wrong repository looks exactly like a report.
  
  It is the same bug class as `d8d9fda`, which scrubbed the bench harness and was
  never carried across to `branchstat`. Every bench bin has carried the scrub
  since; this was the last script in the harness without it. The reusable
  `branchstat` CI workflow was never exposed — a GitHub Actions `run:` step sets
  no `GIT_DIR` — so the only affected path is the local command.
  
  A regression test stands a fixture repo next to a second one with nothing in
  common, points `GIT_DIR` at the second, and pins the report to the first.

## 0.4.2

### Patch Changes

- [#11](https://github.com/abernier/skills/pull/11) [`989ac97`](https://github.com/abernier/skills/commit/989ac97201e642d2d1a833cb94ab11a9e77903f4) Thanks [@abernier](https://github.com/abernier)! - Bench harness: every program gets a `bin` entry, a vitest plugin replaces a
  config a consumer wrote by hand, and two ways the harness could address the
  wrong repository.
  
  - `tracerbench`, `profiler`, `lgtm-perf`, `tracerbench-compare`,
    `profiler-compare` and `profiler-aggregate` are `bin` entries, so a consumer
    writes the name instead of a path into `node_modules` — the README no longer
    shows one. Each shell resolves `BASH_SOURCE` through `realpath` first: `bin`
    installs a symlink, and an unresolved `dirname` lands in `node_modules/.bin`
    where none of the siblings a bench sources exist. The three TypeScript
    programs get a `.sh` wrapper rather than an `npx tsx` shebang — the harness
    runs under the measured repo's own pinned `tsx`, never a fetched one.
  - A program invoked through its bin now says so. The comparers and the
    aggregator print the name that was typed in their usage message instead of a
    `tsx node_modules/…` path, and the "reproduce locally" line in the sticky PR
    comment reads `pnpm exec profiler --control main --threshold 15`. It used to
    render the resolved script path, which under pnpm is a `node_modules/.pnpm/`
    store directory with the package's git URL encoded into it — correct, and
    useless to the reviewer reading it.
  - `@abernier/skills/vite` exports `benchTests()`, which collects
    `profiler-compare.test.ts` as a vitest project. It replaces an `include` and a
    narrowed `exclude` a consumer had to write by hand, where forgetting the
    second silently collected nothing.
  - `tracerbench.sh`, `profiler.sh` and `lgtm-perf.sh` drop every variable
    `git rev-parse --local-env-vars` names before resolving the repository. Under
    a git hook `GIT_DIR` is inherited and wins over both `cwd` and `-C`, so
    `--show-toplevel` answered with the cwd, the bench lock landed in the hook's
    repository and `git worktree add` checked the control branch out of it.
  - `profiler.sh` copies `e2e/gestures.ts` into the control worktree only when the
    repo has one. It is the application's file, not the harness's, and an
    unconditional `cp` killed the run under `set -e` for any repo without it.

## 0.4.1

### Patch Changes

- [#9](https://github.com/abernier/skills/pull/9) [`d8d9fda`](https://github.com/abernier/skills/commit/d8d9fda9494cfda9c1568796fcb355b346aa1d22) Thanks [@abernier](https://github.com/abernier)! - Resolve the repo under test with a scrubbed git environment, so a consumer's
  gate still measures its own tree when it runs from a git hook.
  
  `profiler-compare.test.ts` asks `git rev-parse --show-toplevel` which repository
  it is installed in. That only *discovers* a repository when git does not already
  know which one it is in: a git hook exports `GIT_DIR`, and with it set the
  command answers with the cwd instead. Under `.husky/pre-commit` the answer was
  the package directory inside `node_modules/.pnpm/…`, which has no
  `node_modules/.bin/tsx` — every subprocess came back empty, and the block that
  exists to catch a source tree `.claude/bench.json` has stopped matching skipped
  itself. Measured in a consumer whose gate runs from a hook: the file's 19 tests
  came back 16 failed | 1 passed | 2 skipped; they now all pass, 20 of them with
  the regression test this adds.
  
  The file already built a scrubbed environment for its own `git init`, one bug
  of this same class ago; it is now built first and every git call in the file
  uses it. A test pins the resolution under a worktree-shaped `GIT_DIR`.
  
  No change is needed in a consuming repo.

## 0.4.0

### Minor Changes

- [#7](https://github.com/abernier/skills/pull/7) [`a62d09b`](https://github.com/abernier/skills/commit/a62d09b5b6bbb47525805520b139f73b1769e326) Thanks [@abernier](https://github.com/abernier)! - Run `profiler-aggregate.ts` as a program instead of importing it, and let a
  consumer run `profiler-compare.test.ts` against its own tree.
  
  **Consuming `e2e/profiler.spec.ts` files have to be updated.** The spec no
  longer imports `aggregateCommits` — under `node_modules` that dies at run time
  with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, because Node strips types in
  first-party files only. Drop the import and the fold with it, and write the raw
  commit log instead: one file at `$PROFILER_COMMITS` (default
  `profiler-results/commits.json`), the same report envelope as before, with every
  step carrying the recorder's `commits` where `byComponent` used to be.
  `profiler.sh` then folds each side through the repo's own `tsx`, before the
  diff. The README's bench section spells the shape out, and the CLI refuses a log
  it cannot fold rather than writing the empty aggregate that would read as "no
  regressions".
  
  `profiler-compare.test.ts` now resolves `tsx` and the repo under test from
  `git rev-parse --show-toplevel` rather than from the package directory, so a
  consumer that includes it gets the whole suite — including the block that
  derives a component from the configured `sourceRoots` and catches a source tree
  `.claude/bench.json` has stopped matching. See the README for the vitest
  `include`, and for the `exclude` it has to narrow.

## 0.3.0

### Minor Changes

- [#5](https://github.com/abernier/skills/pull/5) [`eaac659`](https://github.com/abernier/skills/commit/eaac659d787f4c7d98060fe4052a41d9485d9624) Thanks [@abernier](https://github.com/abernier)! - Ship the performance bench harness — `tracerbench`, `profiler` and the
  `lgtm-perf` runner — as `scripts/` a repo can depend on by git ref, instead of
  each repo carrying its own fork of it.
  
  The scripts now resolve two roots rather than one: the package directory they
  live in, for their siblings, and the repository being measured, for everything
  else. `lgtm-perf.sh` reads its local gate widths from `.claude/bench.json`
  (`thresholds.localTracerbenchMs`, `thresholds.localTracerbenchFrames`) instead
  of hard-coding one repo's.

## 0.2.0

### Minor Changes

- [#3](https://github.com/abernier/skills/pull/3) [`3a10ea8`](https://github.com/abernier/skills/commit/3a10ea8aed2b9f62326d2a1fbebdd039aeb64949) Thanks [@abernier](https://github.com/abernier)! - `branchstat` ships as a reusable workflow. A repo that wants the report on every PR calls `abernier/skills/.github/workflows/branchstat.yml` instead of vendoring `branchstat.sh` and a workflow to drive it — the plugin owns branchstat in CI the way it already owns it in a session. The script is read at the ref the caller pinned, so the workflow and the script it runs are never two versions.
  
  Releases are cut with Changesets and tagged `vX.Y.Z` (plus a moving `vX`), which is what a caller pins.
