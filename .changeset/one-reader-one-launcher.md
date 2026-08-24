---
"@abernier/skills": minor
---

`bench.json` has one reader, and the three `.ts` bins have one launcher.

`scripts/bench.config.mjs` is now the only thing that opens `bench.json`.
`profiler.compare.ts` used to open it a second time behind `bench.config.sh`'s
back, with its own defaults written again in a second language — `["src"]` for
`sourceRoots`, `"src/components/ui/"` for `shadcnUiRoot`, which are one
consumer's layout, in a file nobody would think to check. The defaults now live
in one place, `bench.config.sh` is a shell door onto that file, and its
`bench_config` / `bench_config_list` are unchanged.

A bench also spends fewer processes on its config: the door asks `node` once
when it is sourced and answers every key from that in pure bash, where
`tracerbench.sh` used to pay a `node` start per key.

`scripts/bench.launch.sh` holds what `tracerbench.compare.sh`,
`profiler.compare.sh` and `profiler.aggregate.sh` each carried a copy of — the
`GIT_DIR` scrub, the `realpath` on `BASH_SOURCE`, the measured repo's own `tsx`,
and the bin name the program prints in its usage. The three files stay, because
`bin` needs three paths and pnpm execs the file rather than a symlink named
after the command, so `$0` cannot say which program it is. Each is now one line.

Nothing a consumer types changes: the same six bins, at the same paths, with the
same usage strings.
