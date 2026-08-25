---
"@abernier/skills": patch
---

fix(profiler): gzip the cached commit log

A cache entry was 31 MB, and 99% of it was `commits.json` — the whole
catalogue's every fiber render with its cause, against 375 KB for the report
folded out of it. Nothing downstream reads that file: the comparer diffs the
reports, and it is kept only so a cache hit leaves the same artefacts on disk as
the run it stands in for. At five entries that was ~155 MB of `.git` per
consuming repo, for a file read by hand or not at all.

Stored gzipped: 32.6 MB to 874 KB, 37x, at 0.14 s to write and 0.02 s to read
back. The report stays plain — small, and the one file every hit has to open.

No key change is needed to roll this out: the key hashes this harness by
content, so every entry written by 0.13.0 misses and ages out on its own.
