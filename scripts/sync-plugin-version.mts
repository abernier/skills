/**
 * Carry the version Changesets just wrote into everything else that states it.
 *
 * Changesets knows one file, `package.json`. Three others name a version of
 * this repo, and each one is read as an instruction:
 *
 *  - `.claude-plugin/plugin.json` — what Claude Code installs. A release where
 *    the two manifests disagree ships a plugin whose stated version is not the
 *    tag it came from.
 *  - `README.md` — the tags a consumer copies. A stale
 *    `pnpm add -D github:abernier/skills#v0.4.2` installs a package three
 *    minors old, and the subpath the surrounding paragraph documents may not
 *    exist in it. That is not a typo in the docs, it is a broken install.
 *
 * So the pins are rewritten from `package.json` at `changeset:version` time,
 * in the same commit that moves the version. Nothing here is hand-maintained,
 * and nothing can be left behind.
 *
 * The pins are matched by their repo, not by their line: anything spelled
 * `abernier/skills…@vX.Y.Z` or `github:abernier/skills#vX.Y.Z` is one, wherever
 * it sits. `CHANGELOG.md` is deliberately not in the list — its versions are
 * history, not instructions.
 */

import { readFileSync, writeFileSync } from "node:fs";

const PLUGIN = ".claude-plugin/plugin.json";
/** Files whose `abernier/skills` pins state the current release. */
const PINNED = ["README.md"];

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

/** Rewrite `file` through `f`, and say whether it moved. */
function rewrite(file: string, f: (before: string) => string): void {
  const before = readFileSync(file, "utf8");
  const after = f(before);
  if (after === before) {
    console.log(`${file} already reads ${version}.`);
  } else {
    writeFileSync(file, after);
    console.log(`${file} → ${version}`);
  }
}

// Rewritten as text, not as re-serialised JSON: the manifest is hand-edited and
// hand-read, and a formatter pass hidden inside a release step is a diff nobody
// asked for.
rewrite(PLUGIN, (before) =>
  before.replace(/("version":\s*)"[^"]*"/, (_, key: string) => `${key}"${version}"`),
);

for (const file of PINNED) {
  rewrite(file, (before) =>
    before.replace(
      /(abernier\/skills[^\s`'"]*[@#])v\d+\.\d+\.\d+/g,
      (_, pin: string) => `${pin}v${version}`,
    ),
  );
}
