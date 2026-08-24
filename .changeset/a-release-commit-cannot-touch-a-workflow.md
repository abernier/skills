---
"@abernier/skills": patch
---

The release commit no longer rewrites the version pin inside
`.github/workflows/perf.yml`.

Pushing a change to a workflow file needs a `workflows` scope the Actions token
does not have, so a pin there does not go stale — it makes every release push
fail outright. The example in that file now reads `@vX.Y.Z`, and says why. The
README's install line still carries a real version and is still rewritten.
