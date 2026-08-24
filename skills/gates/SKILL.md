---
name: gates
description: Run the right gate before committing, pushing or merging, and read its result honestly. Use when about to commit, push, open a PR, after a git rebase or a stack restack, or when declaring a branch ready to merge.
---

# Gates

Two gates, by convention `lgtm` and `LGTM`.

**Lowercase is the fast suite** — lint, format, types, i18n, dead code, build, unit tests. Run it before every commit and fix what it reports.

**Uppercase extends it with the slow checks** — performance, e2e, regression. Run it only when you genuinely believe a branch is ready to merge; earlier runs slow the loop without catching more.

## Never pipe a gate into `tail`, `head` or `grep`

The shell returns the **last** command's status, so a failing gate piped for brevity exits 0 and reads as green.

```sh
pnpm run lgtm > /tmp/lgtm.log 2>&1
echo "status: $?"
```

Redirect to a file, echo the status, then read the file.

## After a rebase, the tip's typecheck decides

A clean rebase is not a correct rebase. `git rebase` — the engine behind a stack restack — replays commits **without** firing `pre-commit`, so a replay with no git conflict can still leave a broken tip: reordering a stack across a schema change leaves data in the old shape. Git reports success; only `tsc` disagrees.

So a `pre-push` hook running the typecheck is the real guard, and **the absence of a conflict is not evidence**. Never `--no-verify` a push to skip it.

## Pre-merge

Before declaring a branch ready: the heavy gate, then an exhaustive review of `git diff <base>...HEAD` against the repo's own conventions, with severity-tagged findings.

## A new gesture ships with its own perf step

A feature adding a **user gesture** or **persistent on-canvas chrome** adds a matching step to the perf scenarios in the same change. Without it the gates measure only the feature's _passive_ cost and report that as its price — misleading, and unactionable since the number traces to nothing the user does.

**Not automatic.** A step runs on every future comparison, and a gesture an existing mark already covers does not need one. Weigh it; if you skip it, say so in the feature's ADR.

A new step must **bail explicitly when its target is absent**: the control branch predates the feature, so the handle it drives doesn't exist there. A soft-failing wrapper is not enough alone — it catches the error only after the locator burns its full timeout, which costs minutes and, if that timeout approaches the test's own, aborts the control run outright. A new step must never abort or noticeably slow the control run.

## Commits are the developer's call

Propose the commit, the push, the PR with its full details, and wait for an explicit go. Never run them silently.
