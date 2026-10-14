/**
 * Lean project detection and the per-project server registry. Pure Node (no "obsidian"). TASK: docs/tasks/02-projects.md
 */
import * as path from "node:path";
import type { DirFs, ILeanServer, LeanProjectInfo, LeanServerSpec, Logger, ProjectDescriptor, ServerFactory, TimerApi } from "../types";

/** Pick the path flavour from the shape of a path: Windows if it has a drive letter or a backslash. */
function flavourFor(p: string): typeof path.posix {
  return /^[A-Za-z]:|\\/.test(p) ? path.win32 : path.posix;
}

/** Walk up from `startDir` (a DIRECTORY) to the nearest folder containing lakefile.toml (preferred) or lakefile.lean. */
export async function findProjectRoot(startDir: string, fs: DirFs, platform?: NodeJS.Platform): Promise<{ root: string; lakefile: "lakefile.toml" | "lakefile.lean" } | null> {
  const p = platform === "win32" ? path.win32 : path.posix;
  let dir = p.normalize(startDir);
  if (dir.length > p.parse(dir).root.length && /[\\/]$/.test(dir)) dir = dir.slice(0, -1);
  for (;;) {
    if (await fs.exists(p.join(dir, "lakefile.toml"))) return { root: dir, lakefile: "lakefile.toml" };
    if (await fs.exists(p.join(dir, "lakefile.lean"))) return { root: dir, lakefile: "lakefile.lean" };
    const parent = p.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** First non-empty, non-comment line of a lean-toolchain file, trimmed; null when none. */
export function parseLeanToolchain(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return t;
  }
  return null;
}

/** Blank out TOML comments (`#` to end of line, outside quoted strings), keeping the line structure. */
function stripTomlComments(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let quote = "";
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
          if (c === "\\" && quote === '"') i++;
          else if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === "#") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/** Remove Lean comments (`-- ...` and nested `/- ... -/`), keeping string literals and newlines. */
function stripLeanComments(text: string): string {
  let out = "";
  let i = 0;
  let depth = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text.charAt(i);
    const n = text.charAt(i + 1);
    if (depth > 0) {
      if (c === "/" && n === "-") {
        depth++;
        i += 2;
      } else if (c === "-" && n === "/") {
        depth--;
        i += 2;
      } else {
        if (c === "\n") out += "\n";
        i++;
      }
    } else if (inStr) {
      out += c;
      if (c === "\\") {
        out += n;
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
    } else if (c === '"') {
      inStr = true;
      out += c;
      i++;
    } else if (c === "-" && n === "-") {
      while (i < text.length && text.charAt(i) !== "\n") i++;
    } else if (c === "/" && n === "-") {
      depth = 1;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Does this lakefile require Mathlib? (comments are ignored). */
export function detectMathlib(lakefile: "lakefile.toml" | "lakefile.lean", text: string): boolean {
  if (lakefile === "lakefile.toml") {
    let inRequire = false;
    for (const raw of stripTomlComments(text).split("\n")) {
      const t = raw.trim();
      if (t.startsWith("[")) {
        inRequire = /^\[\[\s*require\s*\]\]/.test(t);
        continue;
      }
      if (!inRequire) continue;
      if (/^name\s*=\s*["']mathlib["']/i.test(t)) return true;
      if (/^(git|path)\s*=\s*["'][^"']*mathlib4/i.test(t)) return true;
    }
    return false;
  }
  for (const line of stripLeanComments(text).split(/\r?\n/)) {
    if (!/^\s*require\b/.test(line)) continue;
    if (/^\s*require\s+(?:«mathlib»|mathlib\b)/i.test(line)) return true;
    if (/"leanprover-community"\s*\/\s*(?:"mathlib"|«mathlib»)/i.test(line)) return true;
    if (/mathlib4/i.test(line)) return true;
  }
  return false;
}

function manifestHasMathlib(text: string): boolean {
  try {
    const packages: unknown = (JSON.parse(text) as { packages?: unknown } | null)?.packages;
    return (
      Array.isArray(packages) &&
      packages.some((x: unknown) => {
        const name = (x as { name?: unknown } | null)?.name;
        return typeof name === "string" && name.toLowerCase() === "mathlib";
      })
    );
  } catch {
    return false;
  }
}

export async function describeProject(root: string, lakefile: "lakefile.toml" | "lakefile.lean", fs: DirFs): Promise<ProjectDescriptor> {
  const p = flavourFor(root);
  const read = async (file: string): Promise<string | null> => {
    try {
      return await fs.readFile(file);
    } catch {
      return null;
    }
  };
  const lakeText = (await read(p.join(root, lakefile))) ?? "";
  const toolchainText = await read(p.join(root, "lean-toolchain"));
  let usesMathlib = detectMathlib(lakefile, lakeText);
  if (!usesMathlib) {
    const manifest = await read(p.join(root, "lake-manifest.json"));
    if (manifest !== null) usesMathlib = manifestHasMathlib(manifest);
  }
  if (!usesMathlib) {
    try {
      usesMathlib = await fs.exists(p.join(root, ".lake", "packages", "mathlib"));
    } catch {
      usesMathlib = false;
    }
  }
  return {
    root,
    lakefile,
    toolchain: toolchainText === null ? null : parseLeanToolchain(toolchainText),
    usesMathlib,
  };
}

/** API-facing info: `root` relative to the vault base with "/" separators ("" when equal), toolchain "" when unknown. */
export function toProjectInfo(d: ProjectDescriptor, vaultBase: string): LeanProjectInfo {
  const p = flavourFor(vaultBase);
  const root = p.relative(vaultBase, d.root).split(p.sep).join("/");
  return { root, absRoot: d.root, toolchain: d.toolchain ?? "", usesMathlib: d.usesMathlib };
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

interface Entry {
  key: string;
  project: ProjectDescriptor | null;
  server: ILeanServer;
  refs: number;
  /** In-flight start() shared by concurrent acquirers. */
  starting?: Promise<void>;
  /** Pending idle-shutdown timer handle. */
  idle?: unknown;
}

export class ProjectRegistry {
  private readonly map = new Map<string, Entry>();
  /** In-flight trust checks, so concurrent acquires for one project prompt only once. */
  private readonly trusting = new Map<string, Promise<boolean>>();
  private readonly timers: TimerApi;
  private readonly log: Logger;

  constructor(private readonly deps: RegistryDeps) {
    this.timers = deps.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    this.log = deps.log ?? (() => {});
  }

  /** Server for the file's project (shared), started if needed. Concurrent calls for one project share one start(). */
  async acquire(fileAbsPath: string): Promise<ServerHandle> {
    const dir = flavourFor(fileAbsPath).dirname(fileAbsPath);
    const project = await this.deps.findProject(dir);
    const key = project ? project.root : "loose:" + dir;

    let entry = this.map.get(key);
    if (!entry && project) {
      let trust = this.trusting.get(key);
      if (!trust) {
        trust = this.deps.ensureTrusted(project).finally(() => this.trusting.delete(key));
        this.trusting.set(key, trust);
      }
      if (!(await trust)) throw new ProjectNotTrustedError(project);
      // A concurrent acquire may have created the entry while we were waiting for the prompt.
      entry = this.map.get(key);
    }

    if (entry) {
      entry.refs++;
      this.cancelIdle(entry);
    } else {
      const server = this.deps.factory(this.deps.makeSpec(project, dir));
      entry = { key, project, server, refs: 1 };
      this.map.set(key, entry);
    }

    const e = entry;
    try {
      await this.ensureRunning(e);
    } catch (err) {
      if (this.map.get(key) === e) this.map.delete(key);
      throw err;
    }

    let released = false;
    return {
      key,
      project,
      server: e.server,
      release: () => {
        if (released) return;
        released = true;
        e.refs = Math.max(0, e.refs - 1);
        if (e.refs === 0 && this.map.get(key) === e) this.scheduleIdle(e);
      },
    };
  }

  peek(key: string): ILeanServer | undefined {
    return this.map.get(key)?.server;
  }

  entries(): Array<{ key: string; project: ProjectDescriptor | null; server: ILeanServer; refs: number }> {
    return [...this.map.values()].map((e) => ({ key: e.key, project: e.project, server: e.server, refs: e.refs }));
  }

  /** Stop every server and clear all timers. */
  async dispose(): Promise<void> {
    const all = [...this.map.values()];
    for (const e of all) this.cancelIdle(e);
    this.map.clear();
    await Promise.all(all.map((e) => e.server.stop().catch((err: unknown) => this.log(`stop failed: ${String(err)}`))));
  }

  /** Resolve once the entry's server is running; all callers share one start(). */
  private ensureRunning(e: Entry): Promise<void> {
    if (e.server.state === "running") return Promise.resolve();
    if (!e.starting) {
      e.starting = e.server.start().finally(() => {
        e.starting = undefined;
      });
    }
    return e.starting;
  }

  private scheduleIdle(e: Entry): void {
    const minutes = this.deps.idleMinutes();
    if (!(minutes > 0)) return;
    this.cancelIdle(e);
    e.idle = this.timers.setTimeout(() => {
      e.idle = undefined;
      if (e.refs > 0 || this.map.get(e.key) !== e) return;
      this.map.delete(e.key);
      e.server.stop().catch((err: unknown) => this.log(`idle stop failed: ${String(err)}`));
    }, minutes * 60 * 1000);
  }

  private cancelIdle(e: Entry): void {
    if (e.idle !== undefined) {
      this.timers.clearTimeout(e.idle);
      e.idle = undefined;
    }
  }
}
