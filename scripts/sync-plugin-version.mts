/**
 * Carry the version Changesets just wrote into the plugin manifest.
 *
 * Two manifests name this repo — `package.json` for its own toolchain,
 * `.claude-plugin/plugin.json` for what Claude Code installs — and Changesets
 * only knows the first. A release where they disagree ships a plugin whose
 * stated version is not the tag it came from.
 */

import { readFileSync, writeFileSync } from "node:fs";

const PLUGIN = ".claude-plugin/plugin.json";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

// Rewritten as text, not as re-serialised JSON: the manifest is hand-edited and
// hand-read, and a formatter pass hidden inside a release step is a diff nobody
// asked for.
const before = readFileSync(PLUGIN, "utf8");
const after = before.replace(
  /("version":\s*)"[^"]*"/,
  (_, key: string) => `${key}"${version}"`,
);

if (after === before) {
  console.log(`${PLUGIN} already reads ${version}.`);
} else {
  writeFileSync(PLUGIN, after);
  console.log(`${PLUGIN} → ${version}`);
}
