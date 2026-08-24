---
"@abernier/skills": patch
---

Resolve the repo under test with a scrubbed git environment, so a consumer's
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
