---
"@abernier/skills": minor
---

`local-gate-report` — a new bin that tells GitHub this machine ran a gate on a
commit.

The Actions budget dies partway through most months on a private repo, and
after that every run is refused before a step executes: the pull request turns
red for a reason that says nothing about the code. Both consuming repos already
treat the local gate as the authority, and nothing made that visible.

It deliberately does not hide the red. A workflow run is a check run and this is
a commit status — two objects, shown side by side, the rollup staying red while
either is. Hiding the red is `continue-on-error`, which hides a genuinely
failing gate exactly as well.

Backgrounded by its caller, because a status can only be posted for a commit
GitHub already has: it outlives the push, waits for the commit to land, gives up
quietly, and always exits 0. A reporter that broke a push would cost more than
the red it answers.

    # .husky/pre-push
    local-gate-report "$(git rev-parse HEAD)" "typecheck ($(hostname -s))" \
      "passed before push" >/dev/null 2>&1 &
