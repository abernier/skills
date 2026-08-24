---
"@abernier/skills": patch
---

The profiler's two legs start the same way.

`profiler.sh` ran its experiment leg through the repo's `pnpm run test:profiler`
and its control leg by exec'ing the worktree's `playwright` binary. Everything
that script contributed therefore reached one side only — an environment prefix,
a `pre` hook, a wrapper, and `pnpm run`'s own `PATH` and `npm_*` block, which
Playwright passes on to the web server it spawns. Two failure shapes, and the
second is the one that matters: a control leg that *dies* for it reads as "the
control branch cannot run this bench", which is loud and wrong; a control leg
that merely runs under conditions the experiment never saw is silent, and then
part of the delta is the harness rather than the branch.

Both legs are now started by the harness, with
`playwright.profiler.config.ts`, and neither reads `test:profiler`. That is the
existing invariant applied to the one step that had escaped it — the control
supplies the application, the experiment supplies the apparatus — and it costs
nothing, because `profiler.sh` already names the spec and the config it copies
into the control worktree. `test:profiler` was never consulted for *what* runs,
only for the environment it happened to run in.

`tracerbench.sh` is unchanged and still runs both legs through
`pnpm run test:tracerbench`. It can: its control worktree only builds, and both
its measurement legs run from the repo root against the root's script, config
and `node_modules`.

**BREAKING: the profiler no longer runs your `test:profiler`, no migration.**
Two things to check in a consuming repo:

- **`pretest:profiler` no longer fires.** If it only ran
  `playwright install chromium`, delete it: the harness now installs Chromium
  itself before each leg, asking *that leg's own* Playwright binary. That also
  closes a hole nothing covered — on a control worktree the harness had to
  install into, the binary driving the control leg is the control branch's, and
  neither `pretest:profiler` nor `perf.yml`'s browser cache (keyed on the
  experiment's Playwright version) ever fetched its browser.
- **A profiler `command` may not assume `node_modules/.bin` is on `PATH`.** It
  never was on the control leg; it is now on neither. `pnpm run dev` and
  `pnpm exec vite` are fine — `vite` alone is not. TracerBench is unaffected.

`test:profiler` stays yours, and stays how you run the scenario by hand.
