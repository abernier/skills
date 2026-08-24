/**
 * Per-repo values for the benches, read from `bench.json` at the repo root.
 * The one reader: `bench.config.sh` is a shell door onto this file, and
 * `profiler.compare.ts` imports it. Nothing else opens `bench.json`.
 *
 * The benches are the same everywhere this harness runs; the paths and gate
 * widths they work with are not. Those are values, not forks in the code, so
 * `tracerbench.sh`, `profiler.sh` and `profiler.compare.ts` stay identical
 * across repos and only the JSON differs.
 *
 * At the root, not under `.claude/`: this is committed repo config, read by six
 * plain node/bash bins with no agent in the loop, so it belongs next to
 * `tsconfig.json` and `package.json`. `.claude/` is Claude Code's own directory,
 * and an un-namespaced file squatting in it reads as a native feature it is not.
 *
 * Defaults are the single-package case — one `src`, one `dist`, no workspace
 * packages — so a repo shaped like that needs no config file at all. Every key
 * is optional, and **a key that is absent does not disable a mechanism, it just
 * adds nothing to it**.
 *
 * A file that is absent means the defaults. A file that exists but does not
 * parse is an error, not a default: a typo there would otherwise silently
 * change what the gate measures.
 *
 * Plain `.mjs` rather than `.ts`: the shell half has to run this with bare
 * `node`, before any repo's `tsx` is in the picture, and `bench.config.d.mts`
 * gives the TypeScript half its types. `node` rather than `jq`: no repo can
 * assume jq, and all of them already require node to run a bench at all.
 * That declaration is generated from the JSDoc below — `pnpm run types:emit`.
 * Edit the JSDoc, not the declaration.
 */
/** The config file, repo-root-relative. */
export declare const CONFIG_FILENAME = "bench.json";
/**
 * The defaults, in one place, in one language. Every consumer reads them from
 * here — there is no second copy in a shell call site or in a `.ts` fallback.
 *
 * Only three keys have one. The rest are deliberately default-less, which is
 * the absent-key rule applied to a mechanism rather than a path:
 *
 *  - `workspacePackages`, `controlWorktreeCopy` — a list nobody declared is an
 *    empty list, not a guess at someone's layout.
 *  - `thresholds.*` — a width is one repo's calibration on one machine, so an
 *    absent one adds no gate rather than inventing one. The bench still
 *    measures and still writes its comment; it exits 0 without judging.
 *
 * @type {Pick<BenchConfig, "sourceRoots" | "shadcnUiRoot" | "distDir">}
 */
export declare const DEFAULTS: Pick<BenchConfig, "sourceRoots" | "shadcnUiRoot" | "distDir">;
/**
 * The resolved config for the repository at `rootDir` — the declared keys on
 * top of `DEFAULTS`.
 *
 * `rootDir` is the repository being measured, never the directory this harness
 * is installed in.
 *
 * An absent file means the defaults; a file that exists but does not parse
 * throws.
 *
 * @param {string} rootDir
 * @returns {BenchConfig}
 */
export declare function readBenchConfig(rootDir: string): BenchConfig;
export type BenchConfig = {
    /**
     * Where the app's own components live, repo-relative, in search order.
     */
    sourceRoots: string[];
    /**
     * Vendored shadcn primitives — never actionable, so never gated.
     */
    shadcnUiRoot: string;
    /**
     * Where `pnpm run build` leaves the bundle.
     */
    distDir: string;
    /**
     * Packages whose own `node_modules` a control worktree needs symlinked alongside the root one.
     */
    workspacePackages?: string[];
    /**
     * Extra repo-relative files the control worktree needs, on top of the ones every repo copies.
     */
    controlWorktreeCopy?: string[];
    /**
     * Gate widths, in percent. Absent means no gate — never a default width.
     */
    thresholds?: BenchThresholds;
};
export type BenchThresholds = {
    /**
     * Wall-clock regression gate for CI.
     */
    tracerbenchMs?: number;
    /**
     * Rendered-frames gate for CI — borrows the ms width when it is alone.
     */
    tracerbenchFrames?: number;
    /**
     * The local `bench.lgtm.sh` gate, deliberately tighter than CI's.
     */
    localTracerbenchMs?: number;
    /**
     * The local frames gate; absent, the CI width stands.
     */
    localTracerbenchFrames?: number;
};
/**
 * The resolved contents of `bench.json`, defaults already applied.
 *
 * The three keys with a default are always present. The rest are optional
 * because an absent one means "adds nothing", not "use a guess".
 *
 * @typedef {object} BenchConfig
 * @property {string[]} sourceRoots Where the app's own components live, repo-relative, in search order.
 * @property {string} shadcnUiRoot Vendored shadcn primitives — never actionable, so never gated.
 * @property {string} distDir Where `pnpm run build` leaves the bundle.
 * @property {string[]} [workspacePackages] Packages whose own `node_modules` a control worktree needs symlinked alongside the root one.
 * @property {string[]} [controlWorktreeCopy] Extra repo-relative files the control worktree needs, on top of the ones every repo copies.
 * @property {BenchThresholds} [thresholds] Gate widths, in percent. Absent means no gate — never a default width.
 */
/**
 * Gate widths, in percent. Every one is optional, and an absent one adds no
 * gate rather than inventing a width.
 *
 * @typedef {object} BenchThresholds
 * @property {number} [tracerbenchMs] Wall-clock regression gate for CI.
 * @property {number} [tracerbenchFrames] Rendered-frames gate for CI — borrows the ms width when it is alone.
 * @property {number} [localTracerbenchMs] The local `bench.lgtm.sh` gate, deliberately tighter than CI's.
 * @property {number} [localTracerbenchFrames] The local frames gate; absent, the CI width stands.
 */
