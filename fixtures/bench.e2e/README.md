# bench e2e fixture

The React app `scripts/bench.e2e.test.sh` drives both benches against. A
fixture, not part of the published package — `package.json#files` is an explicit
list and never names it.

Run it on its own, which is the point of it being a directory you can open: when
a bench misbehaves, start the app it was measuring and look at it.

```sh
pnpm run fixture        # from the repo root — vite, on this directory
```

From the repo root because the fixture has no `node_modules` of its own: it
borrows the repo's, and `pnpm --dir` would not find a `vite` in it.

`src/rows.ts` is the one knob — how many rows the list renders. The suite
rewrites it per case to make the experiment side measurably more expensive than
the control's.

<details>
<summary>How the suite uses this directory</summary>

Every case needs three git histories of the same app, so the suite `git init`s a
scratch repo, copies this directory in, and fabricates commits on top. Only the
*history* is synthesised; the source is what you see here.

That scratch repo is where `@abernier/skills` resolves and where `node_modules`
sits, so the two Playwright specs, their configs and the `build` /
`test:tracerbench` / `test:profiler` scripts only run there.

</details>
