#!/usr/bin/env bash
# Tells GitHub that this machine ran a gate on a commit.
#
# The Actions budget dies partway through most months on a private repo. After
# that every run is refused before a step executes, and the pull request turns
# red for a reason that says nothing about the code. Both repos using this
# plugin already treat the local gate as the authority; nothing made that
# visible next to the red.
#
# It does NOT hide the red, and that is deliberate. A workflow run is a *check
# run*, this is a *commit status*: two different objects, shown side by side,
# with the rollup staying red while either is. Hiding the red is
# `continue-on-error`, which hides a genuinely failing gate exactly as well.
# What this adds is a green that means something.
#
# Self-attested by construction: it says "this machine ran this", signed by
# nothing but the machine. On a private repo with one committer that is worth
# precisely what the hook calling it is worth, and no more. Do not reach for it
# as a substitute for a gate anyone else has to trust.
#
# A status can only be posted for a commit GitHub already has, so this cannot
# run before a push and git has no post-push hook. Callers background it: it
# waits for the commit to land, gives up quietly, and never fails.
#
# Exit code is always 0. A reporter that broke a push would cost more than the
# red it is answering.
#
# Usage — as the `local-gate-report` bin, backgrounded from `.husky/pre-push`:
#   local-gate-report "$(git rev-parse HEAD)" "typecheck ($(hostname -s))" \
#     "passed before push" >/dev/null 2>&1 &
#
# Environment:
#   GH                 the CLI to call. Default `gh`. Injectable for tests.
#   LOCAL_GATE_TRIES   how many times to look for the commit. Default 30.
#   LOCAL_GATE_SLEEP   seconds between looks. Default 2.
#                      The defaults are a minute: far longer than a push takes,
#                      short enough to give up quietly on a machine that is
#                      offline.

set -u

sha=${1:-}
context=${2:-}
description=${3:-}

if [ -z "$sha" ] || [ -z "$context" ]; then
  echo "usage: local-gate-report <sha> <context> [description]" >&2
  exit 0
fi

gh_cmd=${GH:-gh}
tries=${LOCAL_GATE_TRIES:-30}
nap=${LOCAL_GATE_SLEEP:-2}

command -v "$gh_cmd" >/dev/null 2>&1 || exit 0

repo=$("$gh_cmd" repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null) || exit 0
[ -n "$repo" ] || exit 0

i=0
while [ "$i" -lt "$tries" ]; do
  if "$gh_cmd" api "repos/$repo/commits/$sha" --silent >/dev/null 2>&1; then
    "$gh_cmd" api -X POST "repos/$repo/statuses/$sha" \
      -f state=success \
      -f context="$context" \
      -f description="$description" >/dev/null 2>&1 || true
    exit 0
  fi
  i=$((i + 1))
  sleep "$nap"
done

exit 0
