---
"@abernier/skills": minor
---

`files` lists what ships instead of subtracting three things from `scripts/`.
Nine test files used to land in every consumer's `node_modules`, one for every
rule this package checks about itself. Eight of them travelled for nothing.

BREAKING: the ninth was never a test of this package, and it has an honest name
now. `scripts/profiler.compare.test.ts` ended in a block that read your
`bench.json`, walked the `sourceRoots` it declares, and gated on whatever
first-party component it found — the check that goes red when a source tree
moved and the config did not. That block is `scripts/bench.conformance.test.ts`,
and `profiler.compare.test.ts` stays here with the rest of the suite.

`benchTests()` follows the rename, so a `vitest.config.ts` using the plugin
needs no change:

```ts
import { benchTests } from "@abernier/skills/bench-tests";

export default defineConfig({ plugins: [benchTests()] });
```

A config that wired the old path by hand has to move:

```diff
-  include: ["node_modules/@abernier/skills/scripts/profiler.compare.test.ts"],
+  include: ["node_modules/@abernier/skills/scripts/bench.conformance.test.ts"],
```
