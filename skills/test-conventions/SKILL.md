---
name: test-conventions
description: Decide what to test and at which level — behaviour over implementation, browser tests over e2e, data attributes over visible text, a failing test before a fix. Use when writing a test, starting a bugfix, or weighing an e2e or perf spec against a cheaper one.
---

# Test conventions

## Assert observable behaviour

Avoid tests that restate the implementation — a constant equal to itself, a template literal producing the expected string. Test **observable behaviour**: state transitions, edge cases, error paths, and the contract between a unit and its consumers.

Test at the cheapest level that uses real browser APIs — DOM, storage, URL.

## Prefer browser tests over e2e

When a behaviour can be verified at the hook or component level with real browser APIs, write a browser-mode test (Vitest) rather than a Playwright e2e spec. Reserve e2e for what genuinely needs a full app boot, multi-tab coordination, or a real backend.

## Weigh an expensive test before writing it

Unit and browser tests are cheap. An e2e spec or a perf-scenario step is not: it runs on every future check, and it has to keep working as the UI changes. The ones that aim at a coordinate are the worst — the coordinate moves, the test fails, and the failure points at the wrong thing.

So it is a judgment call. Ask what the test catches that a cheaper one cannot, whether that regression is likely, and what a false failure will cost. Sometimes the answer is clearly yes: some behaviour only shows at that level. Often it is no.

If you skip it, say so in the ADR that owns the feature, with what adding it later would need. An unrecorded gap gets argued about again.

A convention saying a change "ships with" a test says what a finished change includes. It does not say the test is free.

## No text-based assertions

Never assert on visible text to detect application state (`getByText("Synced")`) — translations change and text is ambiguous. Expose a `data-testid` or a semantic `data-*` attribute (`data-sync-state="synced"`) and assert on that.

## Bugfix: reproduce first, then fix

Start every bug with a failing test, never a blind fix. `mattpocock-skills`' `tdd` and `diagnosing-bugs` own the method; this is the bar it has to clear.

1. Reproduce — a focused test demonstrating the broken behaviour.
2. Fix minimally.
3. Run the full suite for regressions.

Colocate the reproduction with the module it exercises.

## Keep the suite simple

One minimal end-to-end test file with pinned assertions beats a layered test architecture. No oracle machinery, no multi-layer suite, unless it was asked for. Don't constrain too early: too many tests ossify a system before its shape is known.
