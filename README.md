# abernier/skills

A [Claude Code plugin](https://code.claude.com/docs/en/plugins).

## Contents

### Agents

- **`history-scout`** — reads the recent commit log as a topical index, then
  the diffs that match your subject, and returns a briefing instead of a dump.
  Claude delegates to it on its own; call it explicitly with
  `@agent-abernier:history-scout`.

### Commands

- **`/review-merge`** — the pre-merge ritual: two-axis review, seam review,
  merge-readiness sweep, apply, then the repo's own heavy gate. It discovers
  what this repo reviews against and what its gate is called, so it restates no
  threshold of its own.

  Two of its steps use `mattpocock-skills`' `code-review` and `codebase-design`
  skills, so this plugin **depends** on `mattpocock-skills@claude-plugins-official`
  — installing `abernier` installs it, and enabling one enables both. Both steps
  still say what to do without it, and the command reports which path it took.
- **`/branchstat`** — net diff of the branch vs its base. A headline total
  counted the way GitHub counts a PR, then a breakdown of hand-written code only
  — source, tests and config apart — rolled up by module, so the branch says
  where its weight sits.

  ```
  /branchstat                 # vs the resolved base, working tree included
  /branchstat --md main       # as a PR comment
  /branchstat --of some-branch
  ```

  Both commands answer to `/abernier:<name>` too, which is what they are called
  where the bare name is already taken.

  Needs `cloc` for the breakdown (`brew install cloc`); without it the total
  still prints. A repo excludes more than the defaults — lockfiles, prose,
  vendored trees, assets — in `branchstat.json` at its root:

  ```json
  { "exclude": ["packages/www/public/", "src/generated/", "*.snap"] }
  ```

  The same report on every PR, without vendoring the script: the workflow is
  reusable.

  ```yaml
  # .github/workflows/branchstat.yml
  on:
    pull_request:
      types: [opened, synchronize, reopened]

  jobs:
    branchstat:
      uses: abernier/skills/.github/workflows/branchstat.yml@v0.2.0
      permissions:
        contents: read
        pull-requests: write
  ```

  It posts one sticky comment, diffs against the branch the PR targets — the
  parent, for a stacked PR — and reads the script from the ref it was pinned at,
  so the two never drift apart. `inputs.base` overrides what it diffs against,
  `inputs.repro` the footer's "reproduce locally" line.

  Pin the exact tag while this is 0.x: `v0` moves, and a 0.x minor is allowed to
  break. From 1.0 on, `v1` is the ref to use.

### Bench harness

Two benches over one pipeline, for a repo that wants a perf gate on its PRs.
`tracerbench` measures wall-clock durations of Playwright `test.step()` marks.
`profiler` measures React re-renders through `<React.Profiler>`, and gates only
on components it can resolve in your own source. Each builds the current branch
and a `git worktree` of the control branch, benches both sides on paired ports,
diffs the two reports and renders a sticky PR comment.

The pipeline ships here; the scenarios stay yours — `e2e/*.spec.ts`,
`playwright.*.config.ts`, and the `test:tracerbench` / `test:profiler` scripts
that run them.

```
pnpm add -D github:abernier/skills#v0.4.2
```

```json
{
  "scripts": {
    "tracerbench": "tracerbench",
    "profiler": "profiler",
    "LGTM:perf": "lgtm-perf"
  }
}
```

Every program here is a `bin` entry — `tracerbench`, `profiler`, `lgtm-perf`,
`tracerbench-compare`, `profiler-compare`, `profiler-aggregate`. They resolve
from `node_modules/.bin`, so nothing writes a path and nothing cares which
directory you run them from.

`tsx` has to be yours: every script here runs under the `node_modules/.bin/tsx`
of the repo being measured, and this package ships none of its own.

#### Gestures for your specs

A bench measures what a hand does, so the spec has to move like one. Four
primitives, no app imports, importable from a spec:

```ts
import {
  smoothDrag,
  smoothMove,
  wheel,
  wheelBurst,
} from "@abernier/skills/gestures";

await smoothDrag(page, 200, 300, 600, 300, { steps: 40, stepDelay: 8 });
await wheelBurst(page, 400, 300, { deltaY: -400, ctrlKey: true }); // pinch-zoom
await wheelBurst(page, 400, 300, { deltaX: 300, ticks: 10, tickDelay: 25 }); // pan
await wheel(page, 400, 300, { deltaY: -120, ctrlKey: true }); // one notch
```

`smoothMove` and `smoothDrag` walk a straight line one event at a time, with a
delay between steps — `page.mouse.move(x, y, { steps })` fires its intermediate
moves back to back, which is not what a `pointermove` handler is priced against.
`wheelBurst` is `wheel` n times at one point; its `deltaX`/`deltaY` are the
gesture's **totals**, split evenly across the ticks.

<details>
<summary>Why the wheel has two paths, and when the page has seen the event</summary>

`page.mouse.wheel` drops modifier keys, and a pinch-zoom is exactly a wheel with
`ctrlKey` — so `ctrlKey` or `shiftKey` switch `wheel` to a hand-dispatched
`WheelEvent`. That event is untrusted: listeners see it, native scrolling does
not happen. Unmodified, it stays on Playwright's own wheel, which does scroll.

Both paths put the pointer on the point first. The dispatched one aims itself,
but a trusted wheel fires wherever the pointer already sat — so `x, y` would
otherwise mean the point on one path and nothing at all on the other. A burst
moves once, not once per tick: a gesture is one movement.

Playwright's wheel also resolves *before* the page has the event — sent now,
delivered a frame later — so that path waits one frame. Both paths therefore
mean the same thing when they resolve: the page has had the event, and the next
line can assert on its effect.

</details>

The primitives ship as `.mjs` with types beside them, not as `.ts`. Node strips
types in first-party files only; a `.ts` file under `node_modules` throws
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` the moment a spec imports it, and
Playwright does not transform `node_modules` either.

The control worktree resolves them through its own `node_modules`, so nothing
about them needs copying. Gestures that *are* your app's — ones that reach for
its state, or build its scene — stay in your repo and travel by
`controlWorktreeCopy`:

```json
{ "controlWorktreeCopy": ["e2e/gestures.ts"] }
```

#### The render-cause recorder

The profiler's gate comes from a bippy recorder injected before React boots.
Recorder and the `globalSetup` that bundles it both ship here — point your
profiler config at the package and delete your local copies:

```ts
// playwright.profiler.config.ts
export default defineConfig({
  globalSetup: "@abernier/skills/profiler-scan",
});
```

```ts
// e2e/profiler.spec.ts
import { SCAN_BUNDLE_PATH } from "@abernier/skills/profiler-scan";

await page.addInitScript({ path: SCAN_BUNDLE_PATH });
```

`bippy` (`^0.5.39`) and `esbuild` have to be yours: the bundle is built from
your `node_modules` on every run, so the recorder never drifts from the lib your
repo installed. The control worktree needs neither — it receives the IIFE.

The bundle lands at `profiler-results/scan-bundle.js`. `$PROFILER_SCAN_BUNDLE`
names a different file and hands the run to you: when it points at a file that
already exists, `globalSetup` builds nothing and trusts what is there. That is
how `profiler` gives the experiment and the control one byte-identical
recorder, and it is also how you swap in a recorder of your own — build it, set
the variable, and both sides get yours.

<details>
<summary>Why one file ships as <code>.mjs</code> and its neighbour stays <code>.ts</code></summary>

Playwright loads `globalSetup` as a module, from inside `node_modules`. Node
strips types in first-party files only, so a `.ts` there throws
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, and Playwright does not transform
`node_modules` either — hence `.mjs`, with types beside it.

The recorder is never imported by anything. esbuild reads it as an entry point
and transpiles it itself, so it stays `.ts` and keeps its types.

Both resolve their dependencies from the repo being measured, not from this
package: `esbuild` through a `require` rooted at your `package.json`, `bippy`
through esbuild's `nodePaths`. Under pnpm this package's real path is a store
directory whose siblings are its own dependencies, and a plain walk up from
there would miss yours.

</details>

#### On every PR

Both benches on every pull request, without vendoring the pipeline: the workflow
is reusable. The caller keeps the trigger, its `paths:` filter and its
concurrency group — everything else is one `uses:`.

```yaml
# .github/workflows/perf.yml
name: Perf

on:
  # `ready_for_review` lets a draft→ready transition trigger the run.
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    # Only when something the benches measure could have changed.
    paths:
      - "src/**"
      - "e2e/**"
      - "index.html"
      - "vite.config.ts"
      - "package.json"
      - "pnpm-lock.yaml"
      - "playwright.tracerbench.config.ts"
      - "playwright.profiler.config.ts"
      - "bench.json"
      - ".github/workflows/perf.yml"

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  perf:
    uses: abernier/skills/.github/workflows/perf.yml@v0.6.0
    permissions:
      contents: read
      pull-requests: write
    with:
      strict: false
```

It runs `tracerbench` and `profiler` as two legs of one matrix, marks the
previous sticky comment stale while the run is in flight, posts one comment per
bench and uploads the raw traces.

Your repo provides three things: a `.nvmrc`, a `pnpm-lock.yaml`, and the
`tracerbench` / `profiler` bins on `node_modules/.bin` — the `pnpm add -D` above
is what puts them there. Nothing else. The workflow installs pnpm, Node and the
Playwright browsers itself.

<details>
<summary>Inputs, and what stays in the caller</summary>

| input | default | what it decides |
| --- | --- | --- |
| `strict` | `false` | Whether a regression reddens the PR. Strict runs `profiler --strict` and lets both benches fail the job; soft reports in the comment and exits green. |
| `timeout-minutes` | `30` | Per-bench budget. Each bench builds and runs two sides. |
| `node-version-file` | `.nvmrc` | Where the Node version is read from. |

`on:`, `paths:` and `concurrency:` cannot move into a called workflow and stay
correct. The first two are repo-specific by definition. The third because
`github.workflow` inside a called workflow resolves to the *caller's* workflow
name, so the group belongs next to the trigger it cancels.

The workflow installs the toolchain inline rather than calling a
`./.github/actions/setup` of yours: a relative `uses:` inside a called workflow
resolves against whatever is checked out in the workspace, which is your repo,
not this one. Inlining is also what lets the action pins live in one place —
they were two versions apart across the two repos that carried this file.

`permissions:` go on the calling job. A called workflow can only narrow the
token it is given, never widen it, so leaving them out here would not fail
loudly — the comment step would just 403.

Pin the exact tag while this is 0.x: `v0` moves, and a 0.x minor is allowed to
break.

</details>

#### What the profiler spec writes

The profiler runs in three moves — your spec records, `profiler.aggregate.ts`
folds, `profiler.compare.ts` diffs — and the spec only owns the first. It writes
its raw commit log, and nothing else, to `$PROFILER_COMMITS`:

```ts
const COMMITS_PATH =
  process.env.PROFILER_COMMITS ??
  path.resolve(process.cwd(), "profiler-results", "commits.json");

fs.mkdirSync(path.dirname(COMMITS_PATH), { recursive: true });
fs.writeFileSync(COMMITS_PATH, JSON.stringify(commitLog, null, 2));
```

That file is the report envelope, with every step carrying the recorder's raw
`commits` — `window.__renderScan__.snapshot()`, verbatim — where the folded
`byComponent` used to be:

```jsonc
{
  "generatedAt": "2026-08-24T09:12:33.412Z", // ISO 8601
  "url": "http://localhost:4301/",
  "userAgent": "Mozilla/5.0 …",              // optional
  "schemaVersion": 2,
  "steps": [
    {
      "step": "orbit",                       // mark name
      "durationMs": 1843,
      "totalCommits": 12,                    // <React.Profiler> zones
      "byId": {
        "root": {
          "mount": { "count": 1, "actualMs": 8.1, "baseMs": 9.4 },
          "update": { "count": 11, "actualMs": 22.7, "baseMs": 31.2 }
        }
      },
      "scanCommits": 11,                     // optional — commits.length otherwise
      "commits": [
        {
          "renders": [
            {
              "name": "ZoomPan",
              "cause": { "kind": "props", "changed": ["xywh"] },
              "selfTime": 0.4,
              "baseTime": 1.2
            }
          ]
        }
      ]
    }
  ]
}
```

A `cause` is one of `{"kind":"mount"}`, `{"kind":"state"}`, `{"kind":"parent"}`,
`{"kind":"force"}`, `{"kind":"props","changed":[…]}` or
`{"kind":"context","names":[…]}`. Every other key — `diagnostics`, `failures`,
whatever your repo adds — travels through untouched, top level and step level
alike.

`profiler.sh` folds each side itself, before the diff:

```
pnpm exec profiler-aggregate \
  profiler-results/experiment/commits.json \
  profiler-results/experiment/report.json
```

A log it cannot fold — unparseable, no `steps`, a step with no `commits`, a
render with a cause the recorder never produces — exits 2 and stops the bench.
An empty aggregate would read as "no regressions".

Do not `import` `profiler.aggregate.ts` from your spec. Node strips types in
first-party files only, and this one lives under `node_modules`:
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. It is a program, like the two
comparers.

A single-package repo — one `src`, one `dist` — needs no configuration at all.
Everything that differs is a value in `bench.json` at your repository root,
never a fork in the code:

```json
{
  "sourceRoots": ["packages/www/src", "packages/ds/src"],
  "shadcnUiRoot": "packages/ds/src/components/ui/",
  "workspacePackages": ["packages/www", "packages/ds"],
  "distDir": "packages/www/dist",
  "controlWorktreeCopy": ["e2e/marks.ts"],
  "thresholds": { "tracerbenchMs": 50, "tracerbenchFrames": 30 }
}
```

**No threshold declared, no gate.** A gate width is your repo's calibration on
your machine, so there is no default that could be right — run the bench with
the same build on both sides a few times, and the spread it reports is your
floor. Until you declare one, `tracerbench` builds both sides, measures, and
writes its comment with every number and delta, then exits 0 without judging:

```json
{ "thresholds": { "tracerbenchMs": 20 } }
```

That gates wall clock at +20%, and frames at +20% too — frames borrows the ms
width when it declares none of its own. Declare `tracerbenchFrames` alone to
gate frames and leave wall clock open.

<details>
<summary>Every key, and what it defaults to</summary>

Every key is optional, and an absent key adds nothing rather than disabling
anything.

| key | default | what it is |
| --- | --- | --- |
| `sourceRoots` | `["src"]` | where your own components live. The profiler gates on these and nothing else — a regression outside them is reported, never blocking. |
| `shadcnUiRoot` | `"src/components/ui/"` | the directory shadcn's CLI vendors into. Never actionable: the fix for one of these regressing lives at its call site. |
| `workspacePackages` | none | packages whose own `node_modules` the control worktree needs symlinked, alongside the root one. A single-package repo names none. |
| `distDir` | `"dist"` | where `pnpm run build` leaves the bundle. |
| `controlWorktreeCopy` | none | extra repo-relative files the control worktree needs, on top of the specs and configs every repo copies — whatever else your spec imports. |
| `thresholds.tracerbenchMs` | none — no wall-clock gate | wall-clock regression gate, percent. |
| `thresholds.tracerbenchFrames` | the ms width, and no frames gate when that is unset too | rendered-frames gate, percent. |
| `thresholds.localTracerbenchMs` | unset — `tracerbenchMs` stands, so no gate when that is unset too | the same gate for `bench.lgtm.sh`, where a quiet machine deserves a stricter bar than CI's. |
| `thresholds.localTracerbenchFrames` | unset — `tracerbenchFrames` stands | frames, for that local gate. |

</details>

#### Running the compare suite against your own tree

`profiler.compare.test.ts` ships with the package, and its last block is the one
only you can run: it derives its subject from your `sourceRoots` at run time,
and goes red when the source tree moved and `bench.json` did not — the
misconfiguration that otherwise leaves the gate measuring nothing. One plugin
collects it:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { benchTests } from "@abernier/skills/bench-tests";

export default defineConfig({ plugins: [benchTests()] });
```

<details>
<summary>Why a plugin, and what it does to your config</summary>

By hand it is two lines, not one: an `include` naming the file inside
`node_modules`, and an `exclude` narrowed to let it through — vitest's default
covers `node_modules`. Forget the second and nothing fails. The file is not
collected, and the check is quietly dead again.

The plugin adds a vitest **project** holding that one file. It rewrites neither
your `include` nor your `exclude`, so what your config already collects it goes
on collecting — and nothing else in `node_modules` comes along, which is what
narrowing `exclude` really does.

A config that declares no projects gains one: itself, as `{ extends: true }`.
Your suite runs unchanged, under the label `|0|` where the verbose reporter
prints one, next to `|bench|`.

</details>

## Install

```
/plugin marketplace add abernier/skills
/plugin install abernier@abernier-skills
```

## Develop

```
claude --plugin-dir /path/to/skills
```

Run `/reload-plugins` to pick up changes without restarting.

At the repo root both manifests are present, and `claude plugin validate .`
reads the marketplace one. Pass the plugin manifest explicitly to validate the
plugin itself:

```
claude plugin validate .
claude plugin validate .claude-plugin/plugin.json
```

One gate, the same one CI runs:

```
pnpm install
pnpm exec playwright install chromium   # once, for the gesture suite
pnpm run lgtm      # typecheck, shellcheck, the bash suites, vitest
```

`branchstat` carries its own suite because the bucketing regexes and the module
rollup drift silently — a wrong grouping still reads as a plausible table. It
drives the shell entry point, so it covers the git and cloc plumbing and the
TypeScript it pipes into. `tsc` is there because Node *strips* the report's
types at run time and checks nothing; `erasableSyntaxOnly` keeps the file to
what Node can strip.

The gesture primitives carry one too, and it launches Chromium: a stub `Page`
recording `mouse.move` calls would assert the implementation back at itself, and
would catch neither of the things that actually break — a `WheelEvent` reaching
no listener, or a wheel that quietly stopped scrolling. Without the browser the
block skips itself and says so, the same deal `branchstat` strikes with `cloc`.
CI installs it.

`profiler-compare` carries a vitest suite for the same reason from the other
side: it is a real module — a verdict, a normalisation, a codebase filter that
shells out to git and grep — and driving it as a subprocess is the only way to
assert on the exit code CI reads.

The toolchain is this repo's own. The Claude Code half of the plugin installs
nothing in yours; the bench harness is the one part a repo depends on, and it
brings no dependencies with it.

## Release

The plugin is consumed by a git ref, never by an npm install, so a release is a
tag — `vX.Y.Z`, plus a moving `vX`. Changesets decides the number and writes the
changelog:

```
pnpm changeset      # commit the file it writes, with the change it describes
```

Merging to `main` opens a **Release** PR carrying the bump; merging *that* tags
and publishes the release. Nothing goes to npm.

## License

MIT
