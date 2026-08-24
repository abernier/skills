---
name: typescript-conventions
description: TypeScript conventions — inferred types over annotations, satisfies, JSDoc on every exported symbol, Zod as the runtime source of truth. Use when writing or reviewing TypeScript, or when a data structure crosses a validation boundary.
---

# TypeScript conventions

## No unnecessary type annotations

Omit what TypeScript can infer. When a type can't be inferred and you need to constrain a value, prefer `satisfies` so the literal type is preserved.

```ts
const routes = {
  home: "/",
  about: "/about",
} satisfies Record<string, `/${string}`>;
```

## JSDoc on every exported symbol

A multi-line block: a description, a `@param` per **positional** parameter, and an `@example` when it adds clarity.

**No `@returns`** — TypeScript already provides it.

Destructured parameters are exempt, so a component's props object and a hook's config object take none. Document those on the prop **type** instead: one comment per prop, describing what it does, omitting the type.

```ts
type ButtonProps = {
  /** Fires once the press is committed. */
  onPress: () => void;
};
```

Worth enforcing with `eslint-plugin-jsdoc` — `require-jsdoc`, `require-param`, `check-param-names`, `check-tag-names` — plus a `no-restricted-syntax` rule for the `@returns` ban and `checkDestructuredRoots: false`.

## Schema-first with Zod

When a data structure needs runtime validation — a persistence boundary, an external API, IndexedDB — define a **Zod schema as the source of truth** and infer the type:

```ts
const settingsSchema = z.object({
  /** … */
  theme: z.enum(["light", "dark"]).describe("Which palette the app paints with"),
});

type Settings = z.infer<typeof settingsSchema>;
```

Colocate it next to the type it replaces, and `.describe()` each field to preserve the IntelliSense documentation a hand-written `interface` would have carried.
