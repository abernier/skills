import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Agents work in linked git worktrees under `.claude/worktrees/`, each a
    // full copy of this repo, so vitest's default globs find every suite once
    // per worktree on top of the real one — several times over what CI sees.
    // Duplication is the mild half. The sharp half is that a worktree
    // left behind from an older branch carries that branch's tests, so this
    // gate can go red over code that is on no branch at all, or stay green on
    // a suite nobody is editing. A gate has to mean the same thing locally and
    // in CI, and CI has no worktrees.
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
  },
});
