---
"@abernier/skills": minor
---

The shipped `.mjs` modules are typechecked, and their `.d.mts` siblings
are generated from their JSDoc rather than hand-written beside them.

`tsconfig.build.json` globs `scripts/*.mjs`, checks them under
`allowJs`/`checkJs`, and emits the declarations — committed, because consumers
install from a git tag and nothing builds on their side. `pnpm run types:emit`
regenerates them; `pnpm run lgtm` fails if regenerating would change anything.

Repaired along the way: `gestures.mjs` had an orphaned JSDoc block, leaving
`wheel` and `wheelBurst` undocumented and every parameter of `wheel`,
`wheelBurst` and `notch` implicitly `any`.
