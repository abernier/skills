import { createRoot } from "react-dom/client";

import { App } from "./App";

// No `<StrictMode>`: its dev-only double render would double every count for
// no signal, and the fixture wants the smallest deterministic numbers it can
// get.
createRoot(document.getElementById("root")!).render(<App />);
