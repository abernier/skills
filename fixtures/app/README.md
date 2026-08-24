# bench fixture app

The React app `scripts/bench.e2e.test.sh` drives both benches against. A
fixture, not part of the published package — `package.json#files` is an explicit
list and never names it.

Run it on its own, which is the point of it being a directory you can open: when
a bench misbehaves, start the app it was measuring and look at it.

```sh
pnpm -C fixtures/app dev
```

A package of this repo's pnpm workspace, so it has a `node_modules/.bin` of its
own and that command is the whole of it. pnpm does not walk up to an ancestor
`.bin`; without the workspace the only spelling that worked was a
`vite fixtures/…` script at the repo root, in the manifest that gets published.

`src/rows.ts` is the one knob — how many rows the list renders. The suite
rewrites it per case to make the experiment side measurably more expensive than
the control's.

<details>
<summary>How the suite uses this directory</summary>

Every case needs three git histories of the same app, so the suite `git init`s a
scratch repo, copies this directory in, and fabricates commits on top. Only the
*history* is synthesised; the source is what you see here.

That scratch repo is where `@abernier/skills` resolves and where `node_modules`
sits, so the two Playwright specs, their configs and the `test:tracerbench` /
`test:profiler` scripts only run there. `dev`, `preview` and `build` run in both
places.

It is copied in two layouts, and it is the same files both times. Flat — every
file at the scratch repo's root — is the single-package repo the benches'
defaults are written for. The workspace cases move `index.html`, `src/` and this
manifest down into `packages/app/` and leave the specs and their configs at the
root, because that is where both benches address the repo they measure from.

Which is why the two Playwright configs say `pnpm run dev` and
`pnpm run preview` rather than `vite` and `vite preview`. The script name is the
same sentence in both layouts; the manifest next to it is the one file that
knows where the app went. It cannot be an environment variable — the profiler's
control leg execs the worktree's `playwright` binary directly instead of going
through `test:profiler`, so anything that script exports reaches the experiment
side only.

</details>
