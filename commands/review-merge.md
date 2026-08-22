---
description: Pre-merge exhaustive review of the current branch against its base
---

ultrathink — I'm about to merge. Determine the base:
`BASE=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo main)`.

## 0. Read what this repo reviews against — discover it, never assume it

Two things decide how the steps below run, and both are the repo's to say:

- **The standards sources.** Whichever of `CLAUDE.md`, `AGENTS.md`,
  `CODING_STANDARDS.md`, `CONTEXT.md` and `docs/adr/` actually exist — list them,
  don't guess. Where there is an ADR directory, each filename states its rule, so
  the listing is the index.
- **The heavy gate.** The one command this repo runs before a merge: read
  `package.json` scripts (then a `Makefile`, `justfile`, or CI workflow) and take
  the widest one — an uppercase `LGTM` over a lowercase `lgtm`, `lgtm` over
  `check`, `check` over `test`. It owns its own thresholds; **never restate one
  here**, a command that repeats a number is a second place to forget it.

State what you found in one line before going on. A repo with no gate gets step 5
as "there is none" — that is a finding, not a blocker.

## 1. Two-axis review — Standards and Spec

Invoke the **`code-review`** skill — `mattpocock-skills:code-review`, the
two-axis one, **not** Claude Code's built-in `/code-review`, which reviews for
correctness bugs and is a different tool. Fixed point `$BASE`, standards sources
from step 0. It runs Standards (repo conventions + Fowler smell baseline) and
Spec (does the diff match the originating issue/PRD) as parallel sub-agents and
reports them side by side. Don't re-do that review by hand — let the skill own it.

Not installed? Spawn the two sub-agents yourself, in parallel, on the same
`git diff "$BASE"...HEAD`: one reading the diff against the standards sources,
one against the issue or PR body the branch came from. Say which of the two paths
you took — the axes are the same, the reading is not as sharp.

## 2. Seam review — the third axis

The two axes above ask whether the diff is correct and whether it follows the
house rules. Neither asks whether the branch put its behaviour in the **right
place**.

Scope the branch with **`/branchstat`** — the modules that took the charge are the
ones worth reading — then spawn **one sub-agent** to read them in the
**`codebase-design`** vocabulary (`mattpocock-skills:codebase-design`): is the
interface small for the behaviour behind it, is the seam where a caller would
look for it, is a new abstraction earning its keep or passing through.

Not installed? Ask the same three questions in plain words. They are the whole
step; the skill sharpens how it is read and named, and nothing here depends on
having it.

**Delegate it, don't run it inline.** Its input is wide — a branchstat rollup and
several whole modules — while what survives here is a handful of findings. Two
overrides travel with it:

- **Change nothing.** Fixes land in step 4, in one pass, once the other axes have
  had their say. Each finding ends as a **tag** — _inside the diff_ or _outside
  it_ — and that tag is what step 4 applies or drops on.
- **Cap the report.** Everything outside the diff resolves to a remark, and a list
  of remarks right before a merge is noise nobody acts on. So: what it would have
  fixed, plus at most the one or two seams load-bearing enough that a human might
  still say "no, redraw this before it lands" — never an inventory. No ticket, no
  follow-up issue.

Ask for each finding as severity, `path:line`, observation, proposed fix, tag —
data for the list, not prose for the user.

Ideally the seams were checked mid-branch, when a misplaced one was still cheap to
redraw. Running it here is the last net, and a last net catches less.

## 3. Merge-readiness pass — what the review axes don't target

On the same `git diff "$BASE"...HEAD` (+ uncommitted), sweep for pre-merge polish
the review axes don't cover:

- **simplify / minimize the diff** vs base
- **propose well-judged tests/stories** (without forcing it) for introduced
  features not yet covered
- **enrich the documentation** (notably README) and/or comments

For each finding: severity (🔴 blocker / 🟡 important / 🔵 suggestion),
`path:line`, observation, proposed fix. Be honest — no complacency. Write the
review in the user's language.

## 4. Apply the agreed fixes

Apply the blockers and accepted suggestions from steps 1–3 **before** the heavy
gate — running it against code that's about to change would be wasteful.

## 5. The heavy gate — run it once the fixes are applied

Run the gate discovered in step 0, as the repo spells it, with no flags of your
own. **If it fails, investigate before fixing**:

1. **Identify the culprit** — the precise test, component, metric or rule that
   fails, from the gate's own output and the artefacts it leaves behind.
2. **Compare to BEFORE** — the failure is by construction relative to the base.
   Inspect what changed on that precise culprit (`git log "$BASE"..HEAD -- <file>`,
   `git diff "$BASE" -- <file>`) to trace back to the root cause.
3. **Trade-off** — where the gate measures rather than asserts (perf, size,
   coverage), propose several solutions and pick the one that **minimizes the
   observed delta**, not just the one that clears the threshold. An avoidable
   Δ +5% is debt we're about to merge.

Re-run the gate; iterate until everything passes.
