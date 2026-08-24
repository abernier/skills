---
"@abernier/skills": patch
---

`wheel` fires at the point it was given.

The two paths disagreed about what `x, y` meant. The dispatched path — the one a
modifier selects — aims itself through `elementFromPoint`, so it always landed on
the point. The trusted path is `page.mouse.wheel`, which fires wherever the
pointer already happens to be, so it ignored both coordinates entirely. One
signature, two meanings, chosen by a flag the caller was thinking about for an
unrelated reason.

The pointer now goes to the point on both paths, once per gesture. `wheelBurst`
still moves once rather than once per tick: a gesture is one movement, and an app
with a `mousemove` handler should not have to process one per notch — which for a
bench would be measuring the harness rather than the app.
