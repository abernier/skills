---
"@abernier/skills": minor
---

A bench now waits for a bench running in **another** repo, where before it ran
alongside it.

The lock was taken in the repo's own git common directory, so
`tilt/.git/bench.lock` and `sizematters/.git/bench.lock` were different files
and neither run could see the other. Sharing ports and result directories is
only half the reason to serialise a bench; the other half is the CPU, and that
respects no repo boundary. Measured — two agents benching two repos at once,
different ports, different result directories, no resource conflict at all:

```
3 of 4 control legs died on 120 s Playwright timeouts, load average 10.96
a run comparing identical code against itself: +14.5%, over its own +10% gate
```

So the lock moves to `${TMPDIR:-/tmp}/bench.lock` — outside any repo, the same
path for every repo, per-user on macOS, and gone after a reboot. Every worktree
of a repo already shared one lock; now every repo on the machine does too.

And because it spans repos, a second bench **waits** rather than refusing.
Refusing was right when the only way to hit it was launching the same bench
twice; machine-wide it would mean benching one repo kills another repo's gate
for the crime of sharing a machine. The wait names the run it is queued behind,
says how long it has waited, and is bounded at 20 minutes — after which it gives
up and exits non-zero rather than hanging a gate.

```sh
# refuse immediately instead of queueing — a CI runner benches alone
BENCH_LOCK_TIMEOUT=0 pnpm run LGTM:perf
```

`acquire_bench_lock` takes only a label now: the repo root argument is gone,
because the lock no longer belongs to a repo.
