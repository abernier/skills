---
"@abernier/skills": patch
---

`branchstat.sh` drops every variable `git rev-parse --local-env-vars` names
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
