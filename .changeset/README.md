# Changesets

The plugin is not published to npm — it is consumed by a git ref. So Changesets
is here for the two things a ref needs: a version to tag, and a changelog saying
what moved between two tags. `privatePackages.tag` stays off because the tag is
`v0.2.0`, not `@abernier/skills@0.2.0`: an action ref splits on `@`, so the
scoped form is not addressable. `scripts/release-tag.sh` writes it instead.

Add one with `pnpm changeset` and commit it with the change it describes.
