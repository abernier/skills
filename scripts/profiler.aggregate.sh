#!/usr/bin/env bash
# `profiler.aggregate.ts` as a command — the `profiler-aggregate` bin entry.
#
# One of three doors onto `bench.launch.sh`, which holds everything these do and
# why — including why there are three of them rather than one. The only thing a
# door knows is its own two words: the bin name, and the program.
#
# `realpath` here, and again in the launcher, because this is the step that has
# to find the launcher at all: an unresolved `dirname` lands in
# `node_modules/.bin`, where it is not.
# shellcheck source=./bench.launch.sh
source "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/bench.launch.sh" \
  profiler-aggregate profiler.aggregate.ts "$@"
