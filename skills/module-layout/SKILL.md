---
name: module-layout
description: Place a file, a symbol or a new abstraction — feature-oriented organisation, dot-scoped naming, no façade re-exports, dependency inversion at a feature boundary. Use when creating a module, moving or extracting a symbol, naming a sub-module, or weighing whether an abstraction earns its place.
---

# Module layout

Where code goes on disk, and what deserves to become a module at all.

For the design vocabulary behind this — deep modules, interfaces, seams — `mattpocock-skills`' `codebase-design` owns it. This skill is the file-organisation half.

## Organise by feature, not by technical role

Colocate a feature's hook, component and types in one module. Promote a utility to a shared module only when several features depend on it. Before creating a file, check whether an existing module already covers the same ground.

Sub-modules use **dot-scoped naming**, not a subdirectory, so related files stay flat and co-sorted:

```
Feature.ts
Feature.subfeature.ts
Feature.test.ts
```

A test mirrors an existing source file: no `Feature.subfeature.test.ts` when the code under test lives in `Feature.ts`.

When extracting during a refactor, default to placing the code inline in the related module. A new dot-scoped file is the exception, not the reflex.

## One canonical home — no façade re-exports

Each symbol has one home: the file defining it. Don't add a module that exists solely to re-export from another — a back-compat forward, a barrel `index.ts`, a thin wrapper around a third-party import. It hides the real dependency, invites stale "kept for back-compat" comments, and can weaken tree-shaking. Import from the source; update call sites when you move a symbol.

**Exceptions**, where the wrapper adds value: significant JSDoc or contract documentation around a third-party import; the public entry point of a sub-domain aggregating a curated API; grouping a type with its implementation when they live in separate files.

Worth enforcing — `no-restricted-syntax` on `export * from` and `export { … } from`, value or `type`, with an inline disable carrying the reason for an exception.

## Graph checks and file checks don't overlap

A dead-code analyser (Fallow, Knip) owns the graph: circular imports, unused exports and files, unused or unlisted dependencies. ESLint owns the file-level rules — including the façade ban, which a graph tool cannot catch since it only flags an _unused_ re-export. Don't duplicate the graph checks in ESLint (`import/no-cycle`, `import/no-unused-modules`).

## Colocate types with their consumers

Define a type in the file that uses it; promote it to the nearest shared parent when several files need it. Avoid dedicated `*.types.ts` files.

## Feature boundaries: invert the dependency

When Feature A needs behaviour from Feature B without importing it, invert: A exports a contract type (`type FooFn = (…) => Result`), B implements it (`import type` only), and the composition root wires them through a hook parameter, prop or context.

Not pre-emptively, and not for features that naturally colocate.

## Third-party and generated files: do not modify

Never edit what an external tool generates — vendored UI components, config scaffolds — without explicit developer approval. To change behaviour, wrap or compose from the outside. Every local divergence is a merge conflict with the next upgrade, and has to earn that cost with a stated reason.

## New abstractions: the proportionality check

Before committing a helper, an intermediate data structure or a wrapper layer:

1. **What does the existing API already return?** If the data is already available, wire it directly instead of building an intermediary.
2. **Is the fix proportional to the bug?** A diff that feels large relative to its symptom means there is a simpler path.
3. **Delete test:** revert your change mentally. If the problem is solvable with what existed before plus a small tweak, prefer that.

One adapter is a hypothetical seam. Two is a real one.
