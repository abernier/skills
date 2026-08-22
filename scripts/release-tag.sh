#!/usr/bin/env bash
# Tag the version Changesets just wrote, and publish a release for it.
#
# The plugin is consumed by a git ref — `/plugin marketplace add`, and a
# reusable workflow's `uses: …@<ref>` — never by an npm install. So the release
# artefact is the tag itself, and Changesets' own `@scope/name@version` tag is
# no use here: an action ref splits on `@`, so the scoped form is unaddressable.
#
# Two tags per release. The exact `vX.Y.Z` never moves, and is what a caller
# pins. The major `vX` follows it, the convention every published action uses —
# pre-1.0 it says less than it will, a 0.x minor being allowed to break, which
# is why the README pins the exact one for now.
#
# Idempotent: a push to main that changed no version finds its tag already there
# and does nothing, which is most pushes.
set -euo pipefail

version="$(node -p "require('./package.json').version")"
tag="v$version"
major="v${version%%.*}"

if git rev-parse -q --verify "refs/tags/$tag" > /dev/null; then
  echo "$tag is already tagged — nothing to release."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git tag -a "$tag" -m "$tag"
git tag -f -a "$major" -m "$tag"
git push origin "$tag"
git push origin -f "$major"

# The section Changesets just wrote for this version, as the release body — the
# changelog is where the entries already live, and a release that restates them
# in its own words is a second place to be wrong.
notes="$(mktemp)"
awk -v heading="## $version" '
  $0 == heading { found = 1; next }
  found && /^## / { exit }
  found { print }
' CHANGELOG.md > "$notes"

if [ -s "$notes" ]; then
  gh release create "$tag" --title "$tag" --notes-file "$notes"
else
  gh release create "$tag" --title "$tag" --generate-notes
fi
