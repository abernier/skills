---
"@abernier/skills": patch
---

The control worktree now runs the experiment's copy of this package.

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
