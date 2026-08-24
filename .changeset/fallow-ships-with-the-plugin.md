---
"@abernier/skills": minor
---

`fallow@fallow-skills` becomes a dependency, so installing this plugin installs
the dead-code analyser `module-layout` hands the import graph to.

Cross-marketplace dependencies are blocked unless the root marketplace allows
them, so `fallow-skills` joins `allowCrossMarketplaceDependenciesOn`. Add that
marketplace once — `/plugin marketplace add fallow-rs/fallow-skills` — and the
dependency resolves itself.
