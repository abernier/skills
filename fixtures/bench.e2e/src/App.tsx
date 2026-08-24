import { Profiler, useState } from "react";

import { onRender } from "./perf";
// Absent on the `control-legacy` commit `bench.e2e.test.sh` fabricates, which
// is how its "control leg that cannot run" cases break one side: an import the
// control cannot resolve, which is how both real consumers hit this in the
// wild.
import { ROWS } from "./rows";

function Row({ index, tick }: { index: number; tick: number }) {
  return <li>{index + tick}</li>;
}

function List({ tick }: { tick: number }) {
  return (
    <ul>
      {Array.from({ length: ROWS }, (_, index) => (
        <Row key={index} index={index} tick={tick} />
      ))}
    </ul>
  );
}

export function App() {
  const [tick, setTick] = useState(0);
  return (
    <Profiler id="app" onRender={onRender}>
      <main data-testid="app" data-tick={tick}>
        <button data-testid="tick" onClick={() => setTick((t) => t + 1)}>
          tick
        </button>
        <List tick={tick} />
      </main>
    </Profiler>
  );
}
