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
  vendored trees, assets — in `.claude/branchstat.json`:

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
pnpm add -D github:abernier/skills#v0.4.0
```

```json
{
  "scripts": {
    "tracerbench": "bash node_modules/@abernier/skills/scripts/tracerbench.sh",
    "profiler": "bash node_modules/@abernier/skills/scripts/profiler.sh",
    "LGTM:perf": "bash node_modules/@abernier/skills/scripts/lgtm-perf.sh"
  }
}
```

`tsx` has to be yours: every script here runs under the `node_modules/.bin/tsx`
of the repo being measured, and this package ships none of its own.

#### What the profiler spec writes

The profiler runs in three moves — your spec records, `profiler-aggregate.ts`
folds, `profiler-compare.ts` diffs — and the spec only owns the first. It writes
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
tsx node_modules/@abernier/skills/scripts/profiler-aggregate.ts \
  profiler-results/experiment/commits.json \
  profiler-results/experiment/report.json
```

A log it cannot fold — unparseable, no `steps`, a step with no `commits`, a
render with a cause the recorder never produces — exits 2 and stops the bench.
An empty aggregate would read as "no regressions".

Do not `import` `profiler-aggregate.ts` from your spec. Node strips types in
first-party files only, and this one lives under `node_modules`:
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. It is a program, like the two
comparers.

A single-package repo — one `src`, one `dist` — needs no configuration at all.
Everything that differs is a value in `.claude/bench.json`, never a fork in the
code:

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
| `thresholds.tracerbenchMs` | `20` | wall-clock regression gate, percent. |
| `thresholds.tracerbenchFrames` | the ms width | rendered-frames gate, percent. |
| `thresholds.localTracerbenchMs` | `10` | the same gate for `lgtm-perf.sh`, which runs about twice as tight as CI on the grounds that a quiet machine deserves a stricter bar. |
| `thresholds.localTracerbenchFrames` | unset — `tracerbenchFrames` stands | frames, for that local gate. |

</details>

#### Running the compare suite against your own tree

`profiler-compare.test.ts` ships with the package, and its last block is the one
only you can run: it derives its subject from your `sourceRoots` at run time,
and goes red when the source tree moved and `.claude/bench.json` did not — the
misconfiguration that otherwise leaves the gate measuring nothing. Include the
file, and narrow the default `exclude`, which covers `node_modules` and would
hide it:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    include: [
      "src/**/*.test.ts",
      "node_modules/@abernier/skills/scripts/profiler-compare.test.ts",
    ],
    exclude: ["**/dist/**"],
  },
});
```

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
pnpm run lgtm      # typecheck, shellcheck, the bash suites, vitest
```

`branchstat` carries its own suite because the bucketing regexes and the module
rollup drift silently — a wrong grouping still reads as a plausible table. It
drives the shell entry point, so it covers the git and cloc plumbing and the
TypeScript it pipes into. `tsc` is there because Node *strips* the report's
types at run time and checks nothing; `erasableSyntaxOnly` keeps the file to
what Node can strip.

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
