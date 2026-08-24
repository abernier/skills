// The one knob. Both benches read the same number: more rows is more fiber
// renders for the profiler and more milliseconds for TracerBench.
//
// `bench.e2e.test.sh` rewrites this file per case — that is how it makes the
// experiment side measurably more expensive than the control's. The value here
// is only what a standalone `pnpm -C fixtures/app dev` renders.
export const ROWS = 100;
