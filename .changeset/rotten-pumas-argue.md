---
"@abernier/skills": minor
---

The bench pipeline is now a reusable workflow, `.github/workflows/perf.yml`, so
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
