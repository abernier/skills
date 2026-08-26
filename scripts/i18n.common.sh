#!/usr/bin/env bash
# Shared helpers for the i18n commands.
#
# Sourced by i18n.check.sh and i18n.merge.sh — not meant to be run directly.
# After sourcing, the following are available:
#
#   $LANG_DIR                — path to locale JSON files
#   $SRC_DIR                 — source tree the message IDs are read from
#   $tmp_dir                 — temporary working directory (auto-cleaned on exit)
#   collect_locales          — populates $locales, $reference_locale and
#                              $tmp_dir/<locale>.keys for every lang/*.json
#   extract_used_ids         — runs formatjs extract and writes sorted keys
#                              to $tmp_dir/extracted.keys (+ extracted.json)
#   collect_referenced_ids   — writes every ID the source refers to, by any
#                              means, to $tmp_dir/referenced.keys

# Where the repository being checked keeps its catalogs, its sources, and the
# one file it does not want extracted. Every one of the three is a fact about
# the consumer, not about this harness, so each arrives as an environment
# variable — set on the `i18n:check` / `i18n:merge` script in the consumer's
# own `package.json`, where a reader looking for them will look.
#
# `I18N_IGNORE` is the catalog module itself: extracting from it would find
# the keys it imports rather than the ones the UI asks for. Unset means
# nothing is ignored, which is right for a repo that has no such module.
LANG_DIR="${I18N_LANG_DIR:-lang}"
SRC_DIR="${I18N_SRC_DIR:-src}"
IGNORE_GLOB="${I18N_IGNORE:-}"

if [ ! -d "$LANG_DIR" ]; then
  echo "❌ No catalog directory at ${LANG_DIR}/ — set \$I18N_LANG_DIR." >&2
  exit 1
fi
if [ ! -d "$SRC_DIR" ]; then
  echo "❌ No source directory at ${SRC_DIR}/ — set \$I18N_SRC_DIR." >&2
  exit 1
fi

# `jq` sorts object keys by codepoint. `sort` and `comm` sort by the locale's
# collation, which puts "." after "-" in some locales and before it in others,
# and the two orders disagreeing is enough to make `comm` drop keys silently.
# Pin every comparison in this script to the one order jq produces.
export LC_ALL=C

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# Populate $locales (space-separated), $reference_locale, and
# $tmp_dir/<locale>.keys for each locale JSON file found in $LANG_DIR.
collect_locales() {
  reference_locale=""
  locales=""

  for locale_file in "$LANG_DIR"/*.json; do
    locale=$(basename "$locale_file" .json)
    locales="${locales:+$locales }$locale"

    jq -r 'keys[]' "$locale_file" > "$tmp_dir/${locale}.keys"

    count=$(wc -l < "$tmp_dir/${locale}.keys" | tr -d ' ')
    echo "   ${locale}: ${count} keys"

    if [ -z "$reference_locale" ]; then
      reference_locale="$locale"
    fi
  done

  if [ -z "$locales" ]; then
    echo "❌ No locale files found in ${LANG_DIR}/" >&2
    exit 1
  fi

  # shellcheck disable=SC2086 # intentional word-splitting for display
  echo "📖 Locales found: $(echo $locales | sed 's/ /, /g')"
}

# Run formatjs extract and write:
#   $tmp_dir/extracted.json  — raw extraction output
#   $tmp_dir/extracted.keys  — sorted, one key per line
#
# This is the authority on which messages the code *declares* — it is the only
# thing that knows a message's `defaultMessage`, so it alone can answer "which
# IDs are missing from the catalogs". It is *not* the authority on which IDs
# are still in use; see collect_referenced_ids.
extract_used_ids() {
  if [ -n "$IGNORE_GLOB" ]; then
    pnpm exec formatjs extract "$SRC_DIR/**/*.tsx" "$SRC_DIR/**/*.ts" \
      --ignore "$IGNORE_GLOB" \
      --out-file "$tmp_dir/extracted.json" 2>/dev/null
  else
    pnpm exec formatjs extract "$SRC_DIR/**/*.tsx" "$SRC_DIR/**/*.ts" \
      --out-file "$tmp_dir/extracted.json" 2>/dev/null
  fi

  jq -r 'keys[]' "$tmp_dir/extracted.json" > "$tmp_dir/extracted.keys"

  extracted_count=$(wc -l < "$tmp_dir/extracted.keys" | tr -d ' ')
  echo ""
  echo "🔍 formatjs extract found ${extracted_count} unique message IDs in code"
  echo ""
}

# Write every catalog key the source still refers to to
# $tmp_dir/referenced.keys, and the catalog's full key set to
# $tmp_dir/catalog.keys.
#
# `formatjs extract` reads the AST and only recognises an `id` that is a
# literal on a `<FormattedMessage>` or `intl.formatMessage()` call. Plenty of
# live IDs sit elsewhere: in a lookup table (`{ messageId: "planes.tile.center" }`),
# behind a ternary (`id: copied ? "…copied" : "…copyLink"`), or handed to a
# component as a prop (`titleId="about.workflow.step1.title"`). The extractor
# finds none of them, so the check used to call them unused and `--prune`
# would delete their translations in every locale.
#
# So "referenced" is the union of three answers:
#
#   1. what `formatjs extract` found;
#   2. every catalog key spelled out as a whole quoted string anywhere in the
#      source, whatever syntax surrounds it;
#   3. the globs declared in `i18n-dynamic:` comments, for the IDs that are
#      never spelled out at all because the code builds them —
#      `id: `sync2.cloud.${status}``.
#
# Only (1) can prove a message exists, which is why the missing-from-catalog
# check still reads `extracted.keys` alone. (2) and (3) only ever *spare* a
# key from pruning, so an over-broad match costs a stale string rather than a
# lost translation — the right way round for a flag that deletes.
collect_referenced_ids() {
  jq -r 'keys[]' "$LANG_DIR"/*.json | sort -u > "$tmp_dir/catalog.keys"

  # (2) — one pass over the tree rather than one per key: `grep -oF -f` takes
  # the key list as its pattern file and prints each match. The quotes are
  # part of the pattern, so "toolbar.share" cannot match inside
  # "toolbar.share.copied".
  {
    sed 's/^/"/;  s/$/"/'  "$tmp_dir/catalog.keys"
    sed "s/^/'/;  s/\$/'/" "$tmp_dir/catalog.keys"
    sed 's/^/`/;  s/$/`/'  "$tmp_dir/catalog.keys"
  } > "$tmp_dir/quoted.keys"

  : > "$tmp_dir/literal.keys"
  if [ -s "$tmp_dir/quoted.keys" ]; then
    grep -rhoF -f "$tmp_dir/quoted.keys" \
      --include='*.ts' --include='*.tsx' "$SRC_DIR" \
      | sed 's/^.//; s/.$//' | sort -u > "$tmp_dir/literal.keys" || true
  fi

  # (3) — expand each declared glob against the catalog.
  grep -rhoE 'i18n-dynamic: *[A-Za-z0-9_.*?-]+' \
    --include='*.ts' --include='*.tsx' "$SRC_DIR" \
    | sed 's/.*i18n-dynamic: *//' | sort -u > "$tmp_dir/dynamic.globs" || true

  : > "$tmp_dir/dynamic.keys"
  while read -r pattern; do
    while read -r key; do
      # shellcheck disable=SC2254 # $pattern is a glob, deliberately unquoted
      case "$key" in $pattern) echo "$key" >> "$tmp_dir/dynamic.keys" ;; esac
    done < "$tmp_dir/catalog.keys"
  done < "$tmp_dir/dynamic.globs"

  sort -u "$tmp_dir/extracted.keys" \
          "$tmp_dir/literal.keys" \
          "$tmp_dir/dynamic.keys" > "$tmp_dir/referenced.keys"

  indirect_count=$(comm -13 "$tmp_dir/extracted.keys" "$tmp_dir/referenced.keys" | wc -l | tr -d ' ')
  if [ "$indirect_count" -gt 0 ]; then
    echo "🔗 ${indirect_count} more are referenced indirectly — as a plain string"
    echo "   literal, or through an \`i18n-dynamic:\` glob."
    echo ""
  fi
}
