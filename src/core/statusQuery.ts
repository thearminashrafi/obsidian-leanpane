/**
 * Whole-project declaration status via `lake env lean --run <query.lean>`. Node only (no "obsidian").
 * TASK: docs/tasks/07-status-query.md. The Lean program itself (STATUS_QUERY_LEAN) is already written and verified.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, type Dirent } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { DeclState, DeclStatus, DeclSummary, ExecFn, QueryRecord } from "../types";
import { treeExec } from "./execTree";
import { STATUS_QUERY_LEAN } from "./statusQuery.lean";

const CHUNK_SIZE = 100;

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Recursively collect the module name parts of every `.lean` file, skipping dot-directories and lakefile.lean. */
async function collectLeanFiles(dir: string, rel: string[], out: string[][]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      await collectLeanFiles(path.join(dir, e.name), [...rel, e.name], out);
    } else if (e.isFile() && e.name.endsWith(".lean") && e.name !== "lakefile.lean") {
      out.push([...rel, e.name.slice(0, -".lean".length)]);
    }
  }
}

export interface ModuleScan {
  /** Modules (dotted names) with a built .olean under .lake/build/lib/lean, sorted. */
  built: string[];
  /**
   * True when some project source has no .olean or one older than the source: names missing from the built modules may
   * simply not be built yet, so "not found" must not be reported as `missing`.
   */
  stale: boolean;
}

/** Scan the project's sources against their oleans. A root-level `Main.lean` (executable root) is ignored. */
export async function scanModules(projectRoot: string): Promise<ModuleScan> {
  const found: string[][] = [];
  await collectLeanFiles(projectRoot, [], found);
  const built: string[] = [];
  let stale = false;
  await Promise.all(
    found.map(async (parts) => {
      const olean = path.join(projectRoot, ".lake", "build", "lib", "lean", ...parts) + ".olean";
      const src = path.join(projectRoot, ...parts) + ".lean";
      try {
        const [o, s] = await Promise.all([fsp.stat(olean), fsp.stat(src)]);
        built.push(parts.join("."));
        if (o.mtimeMs < s.mtimeMs) stale = true;
      } catch {
        if (!(parts.length === 1 && parts[0] === "Main")) stale = true;
      }
    }),
  );
  return { built: built.sort(), stale };
}

/** Project modules (dotted names) that have a built .olean under .lake/build/lib/lean. Sorted. */
export async function discoverModules(projectRoot: string): Promise<string[]> {
  return (await scanModules(projectRoot)).built;
}

/** Absolute .lean path for a module: project first, then .lake/packages/*; undefined when not found. */
export function moduleToFile(projectRoot: string, module: string): string | undefined {
  if (!module) return undefined;
  const root = path.resolve(projectRoot);
  const parts = module.split(".");
  const local = path.join(root, ...parts) + ".lean";
  if (existsSync(local)) return local;
  const packagesDir = path.join(root, ".lake", "packages");
  let packages: string[];
  try {
    packages = readdirSync(packagesDir).sort();
  } catch {
    return undefined;
  }
  for (const pkg of packages) {
    const candidate = path.join(packagesDir, pkg, ...parts) + ".lean";
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Write STATUS_QUERY_LEAN into `dir` (default os.tmpdir()) once; returns the file path. Idempotent. */
export async function ensureQueryFile(dir: string = os.tmpdir()): Promise<string> {
  const hash = createHash("sha256").update(STATUS_QUERY_LEAN).digest("hex").slice(0, 12);
  const file = path.join(dir, `leanpane-status-query-${hash}.lean`);
  try {
    if ((await fsp.readFile(file, "utf8")) === STATUS_QUERY_LEAN) return file;
  } catch {
    // not there yet: write it below
  }
  await fsp.mkdir(dir, { recursive: true });
  // Write to a unique temp name, then rename, so concurrent callers never see a partial file.
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fsp.writeFile(tmp, STATUS_QUERY_LEAN, "utf8");
  await fsp.rename(tmp, file);
  return file;
}

/** Keep only the JSON-object lines of stdout. */
export function parseQueryOutput(stdout: string): QueryRecord[] {
  const records: QueryRecord[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof value === "object" && value !== null && typeof (value as { name?: unknown }).name === "string") {
      records.push(value as QueryRecord);
    }
  }
  return records;
}

const isMathlibModule = (m: string): boolean => m === "Mathlib" || m.startsWith("Mathlib.");

export function recordToStatus(rec: QueryRecord, now: number, moduleToFileFn?: (module: string) => string | undefined): DeclStatus {
  if (rec.error !== undefined) return { name: rec.name, state: "unknown", source: "none", updatedAt: now };
  if (!rec.exists) return { name: rec.name, state: "missing", source: "build", updatedAt: now };

  let state: DeclState;
  if (rec.ownSorry) state = "stated";
  else if (rec.anySorry) state = "proved-with-sorry-deps";
  else if (rec.module !== undefined && isMathlibModule(rec.module)) state = "mathlib";
  else state = "proved";

  const status: DeclStatus = { name: rec.name, state, source: "build", updatedAt: now };
  if (rec.kind !== undefined) status.kind = rec.kind;
  if (typeof rec.line === "number") status.line = rec.line;
  if (rec.type !== undefined) status.signature = rec.type;
  if (rec.module) {
    const file = moduleToFileFn?.(rec.module);
    if (file !== undefined) status.file = file;
  }
  return status;
}

export interface QueryCommon {
  projectRoot: string;
  /** Absolute path of lake (or "lake"). */
  lakePath: string;
  /** Environment for the child (PATH must contain the elan bin dir). */
  env: NodeJS.ProcessEnv;
  /** Modules to import; default discoverModules(projectRoot). [] => nothing can be answered. */
  modules?: string[];
  /** Some project sources are unbuilt or newer than their .olean (default: scanned when `modules` is not given, else false). */
  stale?: boolean;
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

async function scanFor(opts: QueryCommon): Promise<{ modules: string[]; stale: boolean }> {
  if (opts.modules) return { modules: opts.modules, stale: opts.stale ?? false };
  try {
    const scan = await scanModules(opts.projectRoot);
    return { modules: scan.built, stale: opts.stale ?? scan.stale };
  } catch {
    return { modules: [], stale: true };
  }
}

export async function runStatusQuery(opts: StatusQueryOptions): Promise<Record<string, DeclStatus>> {
  const now = Date.now();
  const result: Record<string, DeclStatus> = {};
  // Every requested name starts as unknown; real answers overwrite it below.
  for (const name of opts.names) result[name] = { name, state: "unknown", source: "none", updatedAt: now };

  const { modules, stale } = await scanFor(opts);
  if (modules.length === 0) return result;

  let queryFile: string;
  try {
    queryFile = await ensureQueryFile(opts.tmpDir);
  } catch {
    return result;
  }

  const exec = opts.exec ?? treeExec;
  const timeoutMs = opts.timeoutMs ?? 120000;
  const resolve = moduleToFile.bind(null, opts.projectRoot);

  for (let i = 0; i < opts.names.length; i += CHUNK_SIZE) {
    if (opts.signal?.aborted) break;
    const chunk = opts.names.slice(i, i + CHUNK_SIZE);
    let records: QueryRecord[];
    try {
      const res = await exec(opts.lakePath, ["env", "lean", "--run", queryFile, "status", modules.join(","), ...chunk], {
        env: opts.env,
        cwd: opts.projectRoot,
        timeoutMs,
      });
      if (res.code !== 0) continue;
      records = parseQueryOutput(res.stdout);
    } catch {
      continue;
    }
    const byName = new Map<string, QueryRecord>();
    for (const rec of records) byName.set(rec.name, rec);
    for (const name of chunk) {
      const rec = byName.get(name);
      if (rec) result[name] = recordToStatus(rec, now, resolve);
    }
  }
  if (stale) {
    // The name may live in a module that is not built (or built from older source): not finding it proves nothing.
    for (const name of opts.names) if (result[name].state === "missing") result[name] = { name, state: "unknown", source: "none", updatedAt: now };
  }
  return result;
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export async function runListQuery(opts: QueryCommon & { prefix?: string }): Promise<DeclSummary[]> {
  try {
    const { modules } = await scanFor(opts);
    if (modules.length === 0 || opts.signal?.aborted) return [];
    const queryFile = await ensureQueryFile(opts.tmpDir);
    const exec = opts.exec ?? treeExec;
    const res = await exec(opts.lakePath, ["env", "lean", "--run", queryFile, "list", modules.join(","), opts.prefix ?? ""], {
      env: opts.env,
      cwd: opts.projectRoot,
      timeoutMs: opts.timeoutMs ?? 120000,
    });
    if (res.code !== 0) return [];

    const summaries: DeclSummary[] = [];
    for (const rec of parseQueryOutput(res.stdout)) {
      const mod = typeof rec.module === "string" ? rec.module : "";
      const file = mod ? (moduleToFile(opts.projectRoot, mod) ?? path.join(...mod.split(".")) + ".lean") : "";
      summaries.push({
        name: rec.name,
        kind: typeof rec.kind === "string" ? rec.kind : "",
        file,
        line: typeof rec.line === "number" ? rec.line : 0,
      });
    }
    summaries.sort((a, b) => compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.name, b.name));
    return summaries;
  } catch {
    return [];
  }
}
