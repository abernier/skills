---
"@abernier/skills": minor
---

The human-like Playwright gestures a bench spec is written with now ship here,
importable from `@abernier/skills/gestures`.

Both consumers carried the same `e2e/gestures.ts`, and the first two thirds of
it were the same bytes on either side: a `smoothMove` that walks a line one
event at a time, and a `smoothDrag` that holds the button down for it. Neither
touches the app it lives in — that is the point of the file, so that
`profiler.sh` can put it next to the spec in a control worktree — which makes it
harness code sitting in two repos, drifting.

The wheel arrived in three shapes: a `wheel` firing one event with modifiers, a
`smoothZoom` firing eight with `ctrlKey` hardcoded, a `smoothPan` looping
`page.mouse.wheel`. They collapse into two:

```ts
import { smoothDrag, wheel, wheelBurst } from "@abernier/skills/gestures";

await smoothDrag(page, 200, 300, 600, 300, { steps: 40, stepDelay: 8 });
await wheelBurst(page, 400, 300, { deltaY: -400, ctrlKey: true }); // zoom
await wheelBurst(page, 400, 300, { deltaX: 300, ticks: 10, tickDelay: 25 }); // pan
```

`wheelBurst` is `wheel` n times at a point, and its deltas are the gesture's
totals rather than a per-notch amount — a hand rolls a wheel a distance. `wheel`
stays on `page.mouse.wheel` unmodified, so an unmodified wheel still scrolls the
page like a real notch, and hand-dispatches only when `ctrlKey` or `shiftKey`
are asked for, which Playwright's wheel drops. Both paths wait until the page
has the event, so the line after an `await` can assert on what it did;
Playwright's own wheel resolves a frame before that, which is a race in every
spec that has ever read a listener's log straight after one.

They ship as `.mjs` with types beside them. A `.ts` file under `node_modules`
throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` the moment a spec imports
it — the rule `profiler-aggregate.ts` already states from the other side — and
Playwright transforms no `node_modules` either. The package still has no build
step.

`profiler.sh` stops copying `e2e/gestures.ts` into the control worktree. The
worktree resolves the package through the `node_modules` it is already given,
the same one its `playwright` binary comes from. A repo whose gestures really
are its app's — reaching for its state, building its scene — keeps that file and
names it in `controlWorktreeCopy`, like everything else a spec imports.
