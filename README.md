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
pnpm run lgtm      # typecheck, shellcheck, the branchstat suite
```

`branchstat` carries its own suite because the bucketing regexes and the module
rollup drift silently — a wrong grouping still reads as a plausible table. It
drives the shell entry point, so it covers the git and cloc plumbing and the
TypeScript it pipes into. `tsc` is there because Node *strips* the report's
types at run time and checks nothing; `erasableSyntaxOnly` keeps the file to
what Node can strip.

The toolchain is this repo's own — the plugin installs nothing in yours.

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
