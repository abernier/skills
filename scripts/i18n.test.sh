#!/usr/bin/env bash
# i18n.test.sh — which message IDs count as referenced, and therefore which
# ones `i18n-merge --prune` is allowed to delete.
#
# Scope: `collect_referenced_ids`, and nothing else. `formatjs extract` is a
# third-party program with its own tests; what needs proving here is the union
# built around it, because that union is the only thing standing between a
# translated string and `--prune`. The extractor's answer is therefore fed in
# rather than produced — `extracted.keys` is a file, and the test writes it.
#
# Every case below is a shape that really cost a repository its translations,
# or a shape that would let a dead key survive for ever. The two mistakes are
# not symmetric: a stale string is noise, a pruned one is five translations to
# redo — so the cases that must be spared outnumber the one that must not.
set -u

script_dir="$(cd "$(dirname "$0")" && pwd)"
fails=0
pass(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail(){ printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }

fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/lang" "$fixture/src"

cat > "$fixture/lang/en.json" <<'JSON'
{
  "extracted.plain": "seen by formatjs",
  "table.entry": "in a lookup table",
  "ternary.a": "behind a ternary",
  "ternary.b": "behind a ternary",
  "prop.title": "handed to a component",
  "built.one": "built at runtime",
  "built.two": "built at runtime",
  "toolbar.share": "a prefix of another key",
  "toolbar.share.copied": "the longer key",
  "commented.out": "named only inside a comment",
  "sub.string": "a substring of an unrelated string",
  "really.dead": "named nowhere at all"
}
JSON

cat > "$fixture/src/App.tsx" <<'TSX'
const TABLE = [{ messageId: "table.entry" }];
const title = <Card titleId="prop.title" />;
const label = intl.formatMessage({ id: copied ? "ternary.a" : "ternary.b" });
const longer = intl.formatMessage({ id: "toolbar.share.copied" });
// const legacy = intl.formatMessage({ id: "commented.out" });
const cls = "prefix-sub.string-suffix";

// i18n-dynamic: built.*
const dyn = intl.formatMessage({ id: `built.${which}` });
TSX

cd "$fixture" || exit 1

# `collect_referenced_ids` needs `$tmp_dir/extracted.keys` in place — that is
# the extractor's half of the answer, and here it is the one key an extractor
# would actually have found in App.tsx.
export I18N_LANG_DIR=lang I18N_SRC_DIR=src
# shellcheck source=./i18n.common.sh
source "$script_dir/i18n.common.sh"
# shellcheck disable=SC2154 # $tmp_dir is set by i18n.common.sh, sourced above
printf 'extracted.plain\n' > "$tmp_dir/extracted.keys"

collect_referenced_ids > /dev/null

referenced(){ grep -qxF "$1" "$tmp_dir/referenced.keys"; }

echo "i18n referenced IDs:"

for id in extracted.plain table.entry ternary.a ternary.b prop.title \
          built.one built.two toolbar.share.copied commented.out; do
  if referenced "$id"; then
    pass "spares \"$id\""
  else
    fail "would prune \"$id\" — a live translation"
  fi
done

if referenced really.dead; then
  fail "spares \"really.dead\" — the check can never recommend a prune again"
else
  pass "prunes \"really.dead\""
fi

# The false-keeps worth ruling out, both of them a key found inside a larger
# string. A whole-key match is what buys these — the pattern carries the
# quotes, so the key has to *be* the string, not merely occur in it.
#
# The two are not the same case. `toolbar.share` inside `toolbar.share.copied`
# is also ruled out by leftmost-longest matching, so it would survive a
# regression in the quoting; `sub.string` inside an unrelated string literal is
# ruled out by the quoting alone, and it is the one that fails when that goes.
if referenced toolbar.share; then
  fail "spares \"toolbar.share\" — matched inside \"toolbar.share.copied\""
else
  pass "does not let \"toolbar.share\" ride on the longer key"
fi

if referenced sub.string; then
  fail "spares \"sub.string\" — matched inside an unrelated string literal"
else
  pass "does not match \"sub.string\" inside a larger string"
fi

if [ "$fails" -eq 0 ]; then
  echo "i18n ✓"
else
  echo "i18n ✗ ($fails failed)"
fi
exit $((fails > 0))
