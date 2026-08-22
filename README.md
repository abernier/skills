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

`branchstat` carries its own suite — the bucketing regexes and the module rollup
drift silently, and a wrong grouping still reads as a plausible table:

```
bash scripts/branchstat.test.sh
```

## License

MIT
