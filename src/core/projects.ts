/**
 * Lean project detection and the per-project server registry. Pure Node (no "obsidian"). TASK: docs/tasks/02-projects.md
 */
import type { DirFs, ILeanServer, LeanProjectInfo, LeanServerSpec, Logger, ProjectDescriptor, ServerFactory, TimerApi } from "../types";

/** Walk up from `startDir` (a DIRECTORY) to the nearest folder containing lakefile.toml (preferred) or lakefile.lean. */
export async function findProjectRoot(_startDir: string, _fs: DirFs, _platform?: NodeJS.Platform): Promise<{ root: string; lakefile: "lakefile.toml" | "lakefile.lean" } | null> {
  throw new Error("TODO(task 02)");
}

/** First non-empty, non-comment line of a lean-toolchain file, trimmed; null when none. */
export function parseLeanToolchain(_text: string): string | null {
  throw new Error("TODO(task 02)");
}

/** Does this lakefile require Mathlib? (comments are ignored). */
export function detectMathlib(_lakefile: "lakefile.toml" | "lakefile.lean", _text: string): boolean {
  throw new Error("TODO(task 02)");
}

export async function describeProject(_root: string, _lakefile: "lakefile.toml" | "lakefile.lean", _fs: DirFs): Promise<ProjectDescriptor> {
  throw new Error("TODO(task 02)");
}

/** API-facing info: `root` relative to the vault base with "/" separators ("" when equal), toolchain "" when unknown. */
export function toProjectInfo(_d: ProjectDescriptor, _vaultBase: string): LeanProjectInfo {
  throw new Error("TODO(task 02)");
}

export class ProjectNotTrustedError extends Error {
  constructor(public readonly project: ProjectDescriptor) {
    super(`Project not trusted: ${project.root}`);
    this.name = "ProjectNotTrustedError";
  }
}

export interface ServerHandle {
  /** Project root, or "loose:<dir>" for files outside any project. */
  key: string;
  project: ProjectDescriptor | null;
  server: ILeanServer;
  /** Give the server back. Idempotent. When the last holder releases, the idle timer starts. */
  release(): void;
}

export interface RegistryDeps {
  factory: ServerFactory;
  makeSpec(project: ProjectDescriptor | null, dirForLoose: string): LeanServerSpec;
  /** Nearest project for a DIRECTORY, or null. */
  findProject(dirAbs: string): Promise<ProjectDescriptor | null>;
  /** Called before the first server for a project is created. Resolve false => ProjectNotTrustedError. */
  ensureTrusted(project: ProjectDescriptor): Promise<boolean>;
  idleMinutes(): number;
  timers?: TimerApi;
  log?: Logger;
}

export class ProjectRegistry {
  constructor(_deps: RegistryDeps) {
    throw new Error("TODO(task 02)");
  }
  /** Server for the file's project (shared), started if needed. Concurrent calls for one project share one start(). */
  acquire(_fileAbsPath: string): Promise<ServerHandle> {
    throw new Error("TODO(task 02)");
  }
  peek(_key: string): ILeanServer | undefined {
    throw new Error("TODO(task 02)");
  }
  entries(): Array<{ key: string; project: ProjectDescriptor | null; server: ILeanServer; refs: number }> {
    throw new Error("TODO(task 02)");
  }
  /** Stop every server and clear all timers. */
  dispose(): Promise<void> {
    throw new Error("TODO(task 02)");
  }
}
