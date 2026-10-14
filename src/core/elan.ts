/**
 * Elan / Lean toolchain discovery. Pure Node (no "obsidian"). TASK: docs/tasks/01-elan.md
 */
import type { DirFs, ElanInfo, ExecFn, LeanServerSpec, ProjectDescriptor } from "../types";
export { defaultExec, nodeFs } from "./nodeio";

export interface DiscoverOptions {
  /** Settings override directory ("" / null = none). */
  settingsDir?: string | null;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Home directory (default os.homedir()). */
  home?: string;
  exec?: ExecFn;
  fs?: DirFs;
  /** Run `elan --version`, `lake --version`, `elan toolchain list` (default true). */
  probe?: boolean;
}

/** Candidate directories that may hold the elan shims, in priority order, without duplicates. */
export function elanCandidateDirs(_o: { settingsDir?: string | null; platform: NodeJS.Platform; home: string; env: NodeJS.ProcessEnv }): string[] {
  throw new Error("TODO(task 01)");
}

export async function discoverElan(_opts?: DiscoverOptions): Promise<ElanInfo> {
  throw new Error("TODO(task 01)");
}

/** Copy of `base` with `info.binDir` prepended to PATH (Windows: the existing key's case, ';' separator). Never mutates `base`. */
export function buildEnv(_info: Pick<ElanInfo, "binDir">, _base: NodeJS.ProcessEnv, _platform?: NodeJS.Platform): NodeJS.ProcessEnv {
  throw new Error("TODO(task 01)");
}

export function parseToolchainList(_stdout: string): { toolchains: string[]; default?: string } {
  throw new Error("TODO(task 01)");
}

/** "Preparing Lean (may download <toolchain>)…" when `toolchain` is not among the installed ones, else null. */
export function toolchainDownloadHint(_toolchain: string | null, _installed: string[]): string | null {
  throw new Error("TODO(task 01)");
}

/** Server launch spec: `lake serve --` in the project root, or `lean --server` in `dirForLoose` when there is no project. */
export function makeServerSpec(_info: ElanInfo, _project: ProjectDescriptor | null, _dirForLoose: string, _baseEnv: NodeJS.ProcessEnv, _platform?: NodeJS.Platform): LeanServerSpec {
  throw new Error("TODO(task 01)");
}
