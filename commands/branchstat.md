---
description: Net diff of the current branch vs its base, bucketed and rolled up by module
argument-hint: "[base] [--md] [--of <branch>] [--depth <n>]"
allowed-tools: Bash(bash:*)
---

!`bash ${CLAUDE_PLUGIN_ROOT}/scripts/branchstat.sh $ARGUMENTS`

The report above is the answer: a headline total counted the way GitHub counts a
PR, then a breakdown of hand-written code only — source, tests and config apart —
rolled up by module so the branch names where its weight sits.

Hand it back as it stands. It is laid out on a column grid and its bars are a
share of their bucket; turning that into prose loses the comparison it exists to
make. Add a sentence only where the user asked something the numbers answer.

`--md` renders it as a PR comment instead, footer included. Without `cloc`
installed only the total prints, and it says so. A repo excludes more than the
defaults in `branchstat.json` at its root — see the header of
`${CLAUDE_PLUGIN_ROOT}/scripts/branchstat.sh`.
