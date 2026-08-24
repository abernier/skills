---
"@abernier/skills": minor
---

The shipped `.mjs` modules are typechecked, and their `.d.mts` siblings
are generated from their JSDoc rather than hand-written beside them.

`tsconfig.build.json` globs `scripts/*.mjs`, checks them under
`allowJs`/`checkJs`, and emits the declarations — committed, because consumers
install from a git tag and nothing builds on their side. `pnpm run types:emit`
regenerates them; `pnpm run lgtm` fails if regenerating would change anything.

Repaired along the way, because a generated declaration is only as good as the
JSDoc behind it:

- `gestures.mjs` had an orphaned JSDoc block, leaving `wheel` and `wheelBurst`
  undocumented and every parameter of `wheel`, `wheelBurst` and `notch`
  implicitly `any`.
- `bench.playwright.mjs` typed its `webServer` escape hatch as `object`, which
  erased Playwright's own field types. It is
  `Partial<NonNullable<PlaywrightTestConfig["webServer"]>>` again, and the eight
  environment variables it documents now travel with the declaration.
- `bench.config.mjs` declared `BenchConfig` only in the file the generator
  overwrites. It is a `@typedef` in the module now, so the type a consumer sees
  is a projection of the reader rather than a claim about it.
