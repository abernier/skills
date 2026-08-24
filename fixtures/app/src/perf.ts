// The `<React.Profiler>` sink. Every consumer has one under some name — the
// profiler's report carries per-zone commit counts and `profiler.compare.ts`
// reads `byId` off every step — so the fixture has the smallest honest version
// of it.
type Bucket = { count: number; actualMs: number; baseMs: number };
type Stats = { mount: Bucket; update: Bucket };

const byId: Record<string, Stats> = {};
const empty = (): Bucket => ({ count: 0, actualMs: 0, baseMs: 0 });

export function onRender(
  id: string,
  phase: string,
  actualMs: number,
  baseMs: number,
) {
  const stats = (byId[id] ??= { mount: empty(), update: empty() });
  const bucket = phase === "mount" ? stats.mount : stats.update;
  bucket.count += 1;
  bucket.actualMs += actualMs;
  bucket.baseMs += baseMs;
}

// The spec reads this between steps, exactly as a consuming app's profiler
// wrapper is read.
(window as unknown as Record<string, unknown>).__perfStats = {
  reset() {
    for (const key of Object.keys(byId)) delete byId[key];
  },
  snapshot() {
    return JSON.parse(JSON.stringify(byId));
  },
};
