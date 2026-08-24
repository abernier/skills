---
"@abernier/skills": minor
---

The doctrine becomes skills.

Eight skills — `doc-routing`, `module-layout`, `typescript-conventions`,
`react-conventions`, `test-conventions`, `visual-debugging`, `gates`, `pre-1-0`
— carrying the conventions an `AGENTS.md` used to spell out in full.

That file kept the rule and the reason together, and paid for both on every task,
in every repo that copied it. Split, a rule lives here and loads when the work
actually touches it. A consuming repo keeps no copy at all — not the reason, not
the mechanism, not a one-line summary — because an echo is a second source of
truth that drifts, in the one file loaded on every task. What was three hundred
lines of always-on prose becomes a table of eight names.

The bar for staying in the consumer is what a skill cannot know: the charter
governing edits to that very file, which has to be in force at the moment the
file is edited; what the repo does differently; and its own names and documents.

Nothing here names a repo. A product stance, a schema shape, a gate's real
command name, the way one app versions its store: those stay with whoever owns
them.

Nothing here re-states `mattpocock-skills` either. `doc-routing` hands the shape
of a decision record to `domain-modeling` and adds only the reason agentic work
needs on top — an approach tried and rejected, unrecorded, gets re-proposed every
few months. `module-layout` hands the deep-module vocabulary to `codebase-design`
and keeps the file-organisation half. Neither names a path, so a repo that never
ran that setup still routes correctly.
