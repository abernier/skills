#!/usr/bin/env bash
# Validates i18n message catalogs against source code.
#
# Uses `formatjs extract` (AST-based) to pull every message ID from source,
# then cross-checks them against the locale JSON files in $I18N_LANG_DIR.
#
# Exit code 1 when:
#   - a message ID is used in code but missing from one or more locale catalogs
#   - locale catalogs have different key sets
#
# Unused keys are reported as warnings. "Unused" means the source refers to
# the key by no means at all — see `collect_referenced_ids` in i18n.common.sh
# for the three it recognises.
#
# Usage — as the `i18n-check` bin, from the repository being checked:
#   I18N_SRC_DIR=src I18N_IGNORE=src/i18n/messages.ts i18n-check

set -eu

# `realpath` because this is the step that has to find the helpers at all: an
# unresolved `dirname` lands in `node_modules/.bin`, where they are not.
# shellcheck source=./i18n.common.sh
source "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/i18n.common.sh"

collect_locales

# ---------- 2. Check catalog consistency across locales ----------

catalog_mismatch=0

# shellcheck disable=SC2154 # locales, reference_locale, tmp_dir set by i18n.common.sh
for locale in $locales; do
  [ "$locale" = "$reference_locale" ] && continue

  missing_in_locale=$(comm -23 "$tmp_dir/${reference_locale}.keys" "$tmp_dir/${locale}.keys")
  extra_in_locale=$(comm -13 "$tmp_dir/${reference_locale}.keys" "$tmp_dir/${locale}.keys")

  if [ -n "$missing_in_locale" ]; then
    catalog_mismatch=1
    echo "" >&2
    echo "❌ Keys in \"${reference_locale}\" but missing in \"${locale}\":" >&2
    echo "$missing_in_locale" | while read -r k; do echo "   - $k" >&2; done
  fi

  if [ -n "$extra_in_locale" ]; then
    catalog_mismatch=1
    echo "" >&2
    echo "❌ Keys in \"${locale}\" but missing in \"${reference_locale}\":" >&2
    echo "$extra_in_locale" | while read -r k; do echo "   - $k" >&2; done
  fi
done

# ---------- 3. Extract used IDs via formatjs extract ----------

extract_used_ids
collect_referenced_ids

# ---------- 4. Cross-reference ----------

# Missing reads `extracted.keys`: only formatjs knows a message's
# `defaultMessage`, so only it can say a message exists at all. Unused reads
# `referenced.keys`, the wider set — deleting a translation deserves the
# stricter proof.
missing_from_catalog=$(comm -23 "$tmp_dir/extracted.keys" "$tmp_dir/${reference_locale}.keys")
unused_in_code=$(comm -13 "$tmp_dir/referenced.keys" "$tmp_dir/${reference_locale}.keys")

has_errors=$catalog_mismatch

if [ -n "$missing_from_catalog" ]; then
  has_errors=1
  echo "❌ Message IDs used in code but MISSING from catalogs:" >&2
  echo "   (run \`pnpm i18n:merge\` to add them)" >&2
  echo "" >&2
  echo "$missing_from_catalog" | while read -r id; do echo "   \"$id\"" >&2; done
  echo "" >&2
fi

if [ -n "$unused_in_code" ]; then
  echo "⚠️  Message IDs in catalogs that the code never refers to:"
  echo ""
  echo "$unused_in_code" | while read -r id; do echo "   \"$id\""; done
  echo ""
  echo "   (If the code builds one at runtime and so never spells it out,"
  echo "    declare it where it is built: \`// i18n-dynamic: some.prefix.*\`.)"
  echo "   (Otherwise run \`pnpm i18n:merge --prune\` to remove them.)"
  echo ""
fi

if [ "$has_errors" -eq 0 ] && [ -z "$unused_in_code" ]; then
  echo "✅ All message IDs are in sync between code and catalogs."
elif [ "$has_errors" -eq 0 ]; then
  echo "✅ No missing message IDs. Unused keys listed above."
fi

exit "$has_errors"
