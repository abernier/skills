---
"@abernier/skills": minor
---

New types-only subpath `@abernier/skills/bench-types`, exporting the bench
harness's wire contract: `RenderCause`, `RenderRecord`, `CommitRecord` and
`PerfIdStats`.

Consuming `e2e/profiler.spec.ts` files re-declared these shapes by hand,
because a value import of a `.ts` file under `node_modules` dies with
"Stripping types is currently unsupported for files under node_modules".
`import type` never reaches Node, so a spec can now read the shapes from the
package instead of copying them:

```ts
import type { CommitRecord, PerfIdStats } from "@abernier/skills/bench-types";
```

`profiler.aggregate.ts` reads them from the same file, so a drift in the
recorder's output has one declaration to break instead of three to fall out of
sync.
