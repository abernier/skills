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
`test:profiler` scripts only run there. `build` runs in both places.

</details>
