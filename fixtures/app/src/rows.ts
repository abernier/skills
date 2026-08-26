// The one knob. Both benches read the same number: more rows is more fiber
// renders for the profiler and more milliseconds for TracerBench.
//
// `bench.e2e.test.sh` rewrites this file per case — that is how it makes the
// experiment side measurably more expensive than the control's. The value here
// is only what a standalone `pnpm run fixture` renders.
//
// `VITE_ROWS` overrides it, and stands in for every knob a real app takes from
// its server's environment. One case uses it to prove that what a consumer's
// `test:profiler` exports reaches both legs of a bench or neither — a variable
// only one leg sees is a delta this harness invented.
export const ROWS = Number(import.meta.env.VITE_ROWS) || 100;
