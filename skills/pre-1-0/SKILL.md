---
name: pre-1-0
description: Break compatibility freely while a project is pre-1.0 — no deprecation shims, no back-compat re-exports, no migrations. Use when a change would break persisted state, a stored schema, URL params, a shared link, or a published API, and when deciding whether that stance still holds.
---

# Pre-1.0: breaking compatibility is free

On a pre-1.0 project the developer leads, with no real users yet: **do not self-bridle for backward compatibility.** No deprecation shims, no back-compat re-exports, no "kept for compatibility" comments. Update the call sites and move on, even when the break reaches persisted state, a stored schema or a shared link.

**You may warn, you must not gate.** Surface the break — a `BREAKING: …, no migration` trailer and a line in your summary — but never avoid, defer or wrap a change to preserve compatibility.

## What that looks like in practice

- Drop a removed URL param outright rather than teach a parser the old shape.
- Let the validator strip unknown keys.
- Version the store — bump the database name — when a shape becomes incompatible, so old data sits unread instead of half-read.
- Write no migration, not even a dot-scoped one. That name stays reserved.

## Sunset

The stance holds only while traction hasn't materialised. Once real users have shared links or persisted data worth honouring, it flips — **ask the developer before assuming the migration-free path is still open.**

Elsewhere, assume compatibility matters.

## When migrations reactivate

One migration is one file, `feature.mig-what-changed.ts`, holding the version it produces, the data it was frozen against, and the conversion. Extract a shared runner only at the second one.

A migration is a statement about data already in the wild. It stops being editable the moment it ships.
