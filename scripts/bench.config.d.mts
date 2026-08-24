/**
 * Types for `bench.config.mjs`. The defaults themselves live there, once —
 * this file only says what shape they have.
 */

/**
 * The resolved contents of `bench.json`, defaults already applied.
 *
 * The three keys with a default are always present. The rest are optional
 * because an absent one means "adds nothing", not "use a guess".
 */
export type BenchConfig = {
  /** Where the app's own components live, repo-relative, in search order. */
  sourceRoots: string[];
  /** Vendored shadcn primitives — never actionable, so never gated. */
  shadcnUiRoot: string;
  /** Where `pnpm run build` leaves the bundle. */
  distDir: string;
  /**
   * Packages whose own `node_modules` a control worktree needs symlinked
   * alongside the root one.
   */
  workspacePackages?: string[];
  /**
   * Extra repo-relative files the control worktree needs, on top of the ones
   * every repo copies.
   */
  controlWorktreeCopy?: string[];
  /** Gate widths, in percent. Absent means no gate — never a default width. */
  thresholds?: {
    /** Wall-clock regression gate for CI. */
    tracerbenchMs?: number;
    /** Rendered-frames gate for CI — borrows the ms width when it is alone. */
    tracerbenchFrames?: number;
    /** The local `bench.lgtm.sh` gate, deliberately tighter than CI's. */
    localTracerbenchMs?: number;
    /** The local frames gate; absent, the CI width stands. */
    localTracerbenchFrames?: number;
  };
};

/** The config file, repo-root-relative: `bench.json`. */
export declare const CONFIG_FILENAME: string;

/** The defaults, in one place — see `bench.config.mjs` for why only three. */
export declare const DEFAULTS: Pick<
  BenchConfig,
  "sourceRoots" | "shadcnUiRoot" | "distDir"
>;

/**
 * Read `bench.json` from `rootDir` and apply the defaults.
 *
 * `rootDir` is the repository being measured, never the directory this harness
 * is installed in. An absent file means the defaults; a file that exists but
 * does not parse throws.
 */
export declare function readBenchConfig(rootDir: string): BenchConfig;
