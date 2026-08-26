#!/usr/bin/env bash
# Merges newly extracted message IDs into every locale JSON file.
#
# Workflow:
#   1. `formatjs extract` pulls all message IDs (+ defaultMessage) from source.
#   2. For each lang/*.json file the script:
#      - keeps existing translations untouched
#      - adds new keys with an empty string "" (to be translated)
#      - removes keys the source no longer refers to (with --prune)
#
# Usage — as the `i18n-merge` bin, from the repository being merged into:
#   I18N_SRC_DIR=src I18N_IGNORE=src/i18n/messages.ts i18n-merge [--prune]
#
# Flags:
#   --prune   Automatically remove keys from locale files that the source no
#             longer refers to. Without this flag, stale keys are only reported.
#
#             "Refers to" is deliberately broader than what `formatjs extract`
#             can see — see `collect_referenced_ids` in i18n.common.sh. A key
#             the extractor misses but the source still names is kept, because
#             the cost of the two mistakes is not symmetric: a stale string is
#             noise, a pruned one is five translations to redo.

set -eu

# `realpath` because this is the step that has to find the helpers at all: an
# unresolved `dirname` lands in `node_modules/.bin`, where they are not.
# shellcheck source=./i18n.common.sh
source "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/i18n.common.sh"

PRUNE=0

for arg in "$@"; do
  case "$arg" in
    --prune) PRUNE=1 ;;
  esac
done

# ---------- 1. Extract message IDs from source ----------

extract_used_ids
collect_referenced_ids

# ---------- 2. Merge into each locale file ----------

has_changes=0

for locale_file in "$LANG_DIR"/*.json; do
  locale=$(basename "$locale_file" .json)

  # Current keys in the locale file
  # shellcheck disable=SC2154 # tmp_dir set by i18n.common.sh
  jq -r 'keys[]' "$locale_file" > "$tmp_dir/${locale}.keys"

  # Keys to add (in extracted but not in locale)
  new_keys=$(comm -23 "$tmp_dir/extracted.keys" "$tmp_dir/${locale}.keys")

  # Keys to remove (in locale, and referred to nowhere in the source)
  stale_keys=$(comm -13 "$tmp_dir/referenced.keys" "$tmp_dir/${locale}.keys")

  if [ -n "$new_keys" ] || [ -n "$stale_keys" ]; then
    has_changes=1
    echo "📝 ${locale}:"
  fi

  # --- Add missing keys ---
  if [ -n "$new_keys" ]; then
    echo "$new_keys" | while read -r key; do
      echo "   + \"$key\""
    done

    # Build a JSON object of {key: defaultMessage} for the new keys
    echo "$new_keys" | jq -Rn '[inputs]' > "$tmp_dir/new_keys.json"

    # Merge: add new keys (with defaultMessage from extracted data), sort
    jq --slurpfile nk "$tmp_dir/new_keys.json" \
       --slurpfile ex "$tmp_dir/extracted.json" \
       '
        . as $locale |
        ($nk[0] | map({(.): ($ex[0][.]?.defaultMessage // "")}) | add // {}) as $additions |
        ($locale + $additions) | to_entries | sort_by(.key) | from_entries
       ' "$locale_file" > "$tmp_dir/merged.json" \
    && mv "$tmp_dir/merged.json" "$locale_file"
  fi

  # --- Handle stale keys ---
  if [ -n "$stale_keys" ]; then
    echo "$stale_keys" | while read -r key; do
      echo "   - \"$key\" (stale)"
    done

    if [ "$PRUNE" -eq 1 ]; then
      echo "$stale_keys" | jq -Rn '[inputs]' > "$tmp_dir/stale_keys.json"

      jq --slurpfile sk "$tmp_dir/stale_keys.json" \
         'delpaths([$sk[0][] | [.]]) | to_entries | sort_by(.key) | from_entries' \
         "$locale_file" > "$tmp_dir/pruned.json" \
      && mv "$tmp_dir/pruned.json" "$locale_file"
      echo "   (pruned)"
    else
      echo "   (use --prune to remove)"
    fi
  fi

  if [ -n "$new_keys" ] || [ -n "$stale_keys" ]; then
    echo ""
  fi
done

if [ "$has_changes" -eq 0 ]; then
  echo "✅ All locale files are already in sync with source code."
else
  echo "✅ Merge complete. Review changes in ${LANG_DIR}/ and translate empty strings."
fi
