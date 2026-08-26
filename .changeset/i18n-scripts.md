---
"@abernier/skills": minor
---

Two new bins, `i18n-check` and `i18n-merge`, for a react-intl repo with a
`lang/*.json` catalog. They arrive with a fix to the thing that made the
`--prune` flag dangerous.

`formatjs extract` reads the AST and only recognises an `id` that is a literal
on a `<FormattedMessage>` or `intl.formatMessage()` call. IDs held in a lookup
table, chosen by a ternary, or handed to a component as a prop are invisible to
it — and a check built on the extractor alone calls those unused, then offers
`--prune` to delete their translations in every locale. On the two repos this
came from, that was 185 and 435 live strings.

So an ID counts as referred to if the extractor found it, **or** it is spelled
out as a whole quoted string anywhere in the source, **or** it matches a glob
declared in an `i18n-dynamic:` comment — the escape hatch for an ID the code
builds and so never spells out. Only the extractor can prove a message exists,
so the missing-from-catalog half still reads it alone; the other two only ever
spare a key.
