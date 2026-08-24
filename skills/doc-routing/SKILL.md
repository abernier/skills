---
name: doc-routing
description: Decide where a piece of knowledge goes — a symbol's own doc, a standalone document, or a decision record — and whether a decision is worth recording at all. Use when documenting something, choosing between a JSDoc and a doc, or wondering whether an ADR is warranted.
---

# Doc routing

Where knowledge goes, once you know it.

A repo's always-loaded instruction file states its own charter — what may and may not be written there. That charter has to be in force at the moment the file is edited, so it lives in the file itself, never here.

## Doc, decision or JSDoc?

**JSDoc** is scoped to one symbol and states only what that symbol does. It is the default.

Write a **doc** when the knowledge has no single symbol home — it spans several, so a JSDoc would be duplicated or arbitrarily parked.

Write an **ADR** when the knowledge concerns what is **not** in the code, or outlives it: delete the symbol, and it stays true.

## Is this decision worth recording?

`mattpocock-skills`' `domain-modeling` owns where decision records live, what shape they take, and the three-part test for writing one: **hard to reverse**, **surprising without the context**, the result of a **real trade-off**. Defer to it rather than restating it; a repo that never ran its setup keeps its records wherever it already keeps such things.

Agentic work adds a fourth reason, independent of those three:

> An approach was **tried and rejected**, and nothing in the code says so — so it gets re-proposed every few months.

Nobody re-litigates a decision they can read. That alone earns the record, whether or not the original choice was hard to reverse.

## Docs are minimal

Short, direct sentences — never a long one carrying three clauses. Prefer a fenced code block over prose: a runnable example says what a paragraph about it only approximates. Cut anything a reader can infer, and fold second-level detail into a `<details>` block so the main line stays readable. Keep related things next to each other, and say each thing once where it belongs.

For how to word a document an agent consumes, `mattpocock-skills`' `writing-for-agents` owns the subject.
