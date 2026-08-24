---
"@abernier/skills": minor
---

One meaning per separator in `scripts/`. A dot separates scopes
(`feature.subfeature.ext`), a hyphen joins words inside one name, and no file
carries a leading underscore. `bench.*` is what the two benches share;
`tracerbench.*` and `profiler.*` belong to one of them.

Public command names are unchanged — `profiler-compare` is still
`profiler-compare`, even though its file is now `profiler.compare.sh`.

BREAKING: the `./vite` export subpath is now `./bench-tests`, with no alias. The
subpath said "vite", the file said "vite", the export is `benchTests()`, the
plugin id is `@abernier/skills:bench-tests` and the vitest project is `"bench"` —
four names for one thing, folded into one.

```diff
-import { benchTests } from "@abernier/skills/vite";
+import { benchTests } from "@abernier/skills/bench-tests";
```
