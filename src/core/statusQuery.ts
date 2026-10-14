/**
 * Whole-project declaration status via `lake env lean --run <query.lean>`. Node only (no "obsidian").
 * TASK: docs/tasks/07-status-query.md. The Lean program itself (STATUS_QUERY_LEAN) is already written and verified.
 */
import type { DeclStatus, DeclSummary, ExecFn, QueryRecord } from "../types";

/** Project modules (dotted names) that have a built .olean under .lake/build/lib/lean. Sorted. */
export async function discoverModules(_projectRoot: string): Promise<string[]> {
  throw new Error("TODO(task 07)");
}

/** Absolute .lean path for a module: project first, then .lake/packages/*; undefined when not found. */
export function moduleToFile(_projectRoot: string, _module: string): string | undefined {
  throw new Error("TODO(task 07)");
}

/** Write STATUS_QUERY_LEAN into `dir` (default os.tmpdir()) once; returns the file path. Idempotent. */
export async function ensureQueryFile(_dir?: string): Promise<string> {
  throw new Error("TODO(task 07)");
}

/** Keep only the JSON-object lines of stdout. */
export function parseQueryOutput(_stdout: string): QueryRecord[] {
  throw new Error("TODO(task 07)");
}

export function recordToStatus(_rec: QueryRecord, _now: number, _moduleToFile?: (module: string) => string | undefined): DeclStatus {
  throw new Error("TODO(task 07)");
}

export interface QueryCommon {
  projectRoot: string;
  /** Absolute path of lake (or "lake"). */
  lakePath: string;
  /** Environment for the child (PATH must contain the elan bin dir). */
  env: NodeJS.ProcessEnv;
  /** Modules to import; default discoverModules(projectRoot). [] => nothing can be answered. */
  modules?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Where the query file is written (default os.tmpdir()). */
  tmpDir?: string;
  /** Test seam; default: real process execution. */
  exec?: ExecFn;
}
export interface StatusQueryOptions extends QueryCommon {
  names: string[];
}
export async function runStatusQuery(_opts: StatusQueryOptions): Promise<Record<string, DeclStatus>> {
  throw new Error("TODO(task 07)");
}
export async function runListQuery(_opts: QueryCommon & { prefix?: string }): Promise<DeclSummary[]> {
  throw new Error("TODO(task 07)");
}
