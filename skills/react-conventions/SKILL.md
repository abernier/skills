---
name: react-conventions
description: React conventions — composition over prop threading, controlled/uncontrolled split, usehooks-ts first, no latest-ref antipattern, no manual memoisation under the compiler, no hard-coded user-facing strings, URL as a projection of state. Use when writing or reviewing a component or a hook.
---

# React conventions

## Composition over prop threading

Prefer composition — `children`, render props, context — over threading data through intermediary components. When a parent only forwards props, use `children` so each child is instantiated directly in JSX.

## Controlled / uncontrolled split

Split a stateful component in two **only when a concrete consumer benefits** from the controlled variant: a Storybook story, a visual test, reuse elsewhere. The indirection isn't worth it before that.

When warranted, **controlled** (`MycompControlled`) is pure presentational — all data and callbacks via props, no context reads, no side-effecting hooks — and the **uncontrolled** wrapper (`Mycomp`) wires it to application state and forwards everything as props.

For a single prop that must support both usages, Radix's `useControllableState` is a drop-in `useState` replacement that also accepts a controlled value and `onChange`.

## Prefer `usehooks-ts` hooks

Before writing a custom hook, check whether [`usehooks-ts`](https://usehooks-ts.com/) already has it.

## No `useRef` to dodge effect dependencies

Never store a value in a ref just to keep it out of a `useEffect` dependency array. The ["latest ref" antipattern](https://react.dev/reference/react/useRef#caveats) hides dependency relationships from React and the linter. Make the dependency stable at the call site — `useCallback`, a module-level function, memoisation — and list it normally.

**Exception, stable identity plus always-fresh reads:** for a callback exposed via context (so consumers list it in deps) that must also read fresh state, use `useEventCallback` from `usehooks-ts`. `useEffectEvent` has the same semantics, but `react-hooks/rules-of-hooks` forbids exposing its return through a context value, and disabling that rule cascades into a React Compiler bailout for the whole component.

## The compiler memoizes for you

The React Compiler auto-memoizes values, callbacks **and JSX** in compiled components. The default is **no manual `memo()` / `useMemo` / `useCallback`**, and the bar for adding one is a **profiler trace, never a hunch**.

The parts that bite: a Rules-of-React violation makes the compiler bail out silently on that component; the `"use memo"` directive opts a file in; and memoisation granularity follows call boundaries, not the shape you imagined.

## React state is the source of truth, the URL is its reflection

React state is the single source of truth; the URL is a derived projection. Never read `window.location` for current app state during the app's lifetime — read React state.

The one exception is **bootstrap**, before React has rendered, where the URL _is_ the user's navigation intent.

## No hard-coded user-facing strings

Never hard-code user-facing text — labels, toasts, errors, tooltips — in components or hooks. Use the translation system and add the key to every locale file, so the string is translatable from day one.
