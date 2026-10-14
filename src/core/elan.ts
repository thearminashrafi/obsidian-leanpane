/**
 * Elan / Lean toolchain discovery. Pure Node (no "obsidian"). TASK: docs/tasks/01-elan.md
 */
import { homedir } from "node:os";
import * as path from "node:path";
import type { DirFs, ElanInfo, ExecFn, LeanServerSpec, ProjectDescriptor } from "../types";
import { defaultExec, nodeFs } from "./nodeio";
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

const pathApi = (platform: NodeJS.Platform): path.PlatformPath => (platform === "win32" ? path.win32 : path.posix);

/** The PATH variable's actual key: Windows matches case-insensitively ("Path", "PATH"). */
function pathKey(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  if (platform !== "win32") return "PATH" in env ? "PATH" : undefined;
  return Object.keys(env).find((k) => k.toUpperCase() === "PATH");
}

/** Candidate directories that may hold the elan shims, in priority order, without duplicates. */
export function elanCandidateDirs(o: { settingsDir?: string | null; platform: NodeJS.Platform; home: string; env: NodeJS.ProcessEnv }): string[] {
  const win = o.platform === "win32";
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (d: string): void => {
    if (!d) return;
    const k = win ? d.toLowerCase() : d;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(d);
  };
  if (o.settingsDir) add(o.settingsDir);
  add(pathApi(o.platform).join(o.home, ".elan", "bin"));
  const key = pathKey(o.env, o.platform);
  const pathValue = key === undefined ? undefined : o.env[key];
  for (const entry of (pathValue ?? "").split(win ? ";" : ":")) add(entry);
  return out;
}

/** File names a tool may have in a directory: Windows tries .exe, .bat, .cmd. */
function exeNames(tool: string, platform: NodeJS.Platform): string[] {
  return platform === "win32" ? [`${tool}.exe`, `${tool}.bat`, `${tool}.cmd`] : [tool];
}

async function findTool(dir: string, tool: string, platform: NodeJS.Platform, fs: DirFs): Promise<string | null> {
  for (const name of exeNames(tool, platform)) {
    const full = pathApi(platform).join(dir, name);
    if (await fs.exists(full)) return full;
  }
  return null;
}

async function firstDirWith(dirs: string[], tool: string, platform: NodeJS.Platform, fs: DirFs): Promise<string | null> {
  for (const d of dirs) {
    if (await findTool(d, tool, platform, fs)) return d;
  }
  return null;
}

export async function discoverElan(opts: DiscoverOptions = {}): Promise<ElanInfo> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const fs: DirFs = opts.fs ?? nodeFs;
  const exec: ExecFn = opts.exec ?? defaultExec;
  const probe = opts.probe ?? true;

  const dirs = elanCandidateDirs({ settingsDir: opts.settingsDir, platform, home, env });
  // The shim directory is where lake, else lean, else elan is first found. All three are then looked up there only,
  // so an elan shim elsewhere is not paired with a lake from another installation.
  const binDir =
    (await firstDirWith(dirs, "lake", platform, fs)) ??
    (await firstDirWith(dirs, "lean", platform, fs)) ??
    (await firstDirWith(dirs, "elan", platform, fs));
  const lakePath = binDir ? await findTool(binDir, "lake", platform, fs) : null;
  const leanPath = binDir ? await findTool(binDir, "lean", platform, fs) : null;
  const elanPath = binDir ? await findTool(binDir, "elan", platform, fs) : null;

  const info: ElanInfo = { binDir: binDir ?? null, lakePath, leanPath, elanPath, toolchains: [] };
  if (!probe) return info;

  const probeEnv = buildEnv({ binDir: info.binDir }, env, platform);
  /** Stdout of a successful run, or null when it throws or exits non-zero. Never throws. */
  const run = async (file: string, args: string[]): Promise<string | null> => {
    try {
      const r = await exec(file, args, { env: probeEnv, timeoutMs: 8000 });
      return r.code === 0 ? r.stdout : null;
    } catch {
      return null;
    }
  };
  const firstLine = (s: string | null): string | undefined => s?.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);

  if (elanPath) {
    const v = firstLine(await run(elanPath, ["--version"]));
    if (v) info.elanVersion = v;
  }
  if (lakePath) {
    const v = firstLine(await run(lakePath, ["--version"]));
    if (v) info.lakeVersion = v;
  }
  if (elanPath) {
    const out = await run(elanPath, ["toolchain", "list"]);
    if (out !== null) {
      const parsed = parseToolchainList(out);
      info.toolchains = parsed.toolchains;
      if (parsed.default) info.defaultToolchain = parsed.default;
    }
  }
  return info;
}

/** Copy of `base` with `info.binDir` prepended to PATH (Windows: the existing key's case, ';' separator). Never mutates `base`. */
export function buildEnv(info: Pick<ElanInfo, "binDir">, base: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...base };
  const binDir = info.binDir;
  if (!binDir) return out;
  const win = platform === "win32";
  const sep = win ? ";" : ":";
  const key = pathKey(base, platform) ?? "PATH";
  const current = base[key];
  if (!current) {
    out[key] = binDir;
    return out;
  }
  const first = current.split(sep)[0];
  const same = win ? first.toLowerCase() === binDir.toLowerCase() : first === binDir;
  if (!same) out[key] = binDir + sep + current;
  return out;
}

/** Parses `elan toolchain list`: one name per line, trailing "(default)"/"(override)"/"(resolved ...)" suffixes removed. */
export function parseToolchainList(stdout: string): { toolchains: string[]; default?: string } {
  const toolchains: string[] = [];
  let def: string | undefined;
  for (const raw of stdout.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || /^no installed toolchains/i.test(line)) continue;
    let isDefault = false;
    let m = /\s*\(([^()]*)\)$/.exec(line);
    while (m) {
      if (m[1].trim().toLowerCase() === "default") isDefault = true;
      line = line.slice(0, m.index).trim();
      m = /\s*\(([^()]*)\)$/.exec(line);
    }
    if (!line) continue;
    toolchains.push(line);
    if (isDefault && def === undefined) def = line;
  }
  return def === undefined ? { toolchains } : { toolchains, default: def };
}

/** Strips the origin prefix and surrounding whitespace so "v4.25.1" equals "leanprover/lean4:v4.25.1". */
const normaliseToolchain = (s: string): string => s.trim().replace(/^leanprover\/lean4:/, "");

/** "Preparing Lean (may download <toolchain>)…" when `toolchain` is not among the installed ones, else null. */
export function toolchainDownloadHint(toolchain: string | null, installed: string[]): string | null {
  if (!toolchain || !toolchain.trim()) return null;
  const want = normaliseToolchain(toolchain);
  if (installed.some((t) => normaliseToolchain(t) === want)) return null;
  return `Preparing Lean (may download ${toolchain})…`;
}

/** Server launch spec: `lake serve --` in the project root, or `lean --server` in `dirForLoose` when there is no project. */
export function makeServerSpec(
  info: ElanInfo,
  project: ProjectDescriptor | null,
  dirForLoose: string,
  baseEnv: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): LeanServerSpec {
  const env = buildEnv(info, baseEnv, platform);
  if (project) {
    return { kind: "lake", command: info.lakePath ?? "lake", args: ["serve", "--"], cwd: project.root, env };
  }
  return { kind: "lean", command: info.leanPath ?? "lean", args: ["--server"], cwd: dirForLoose, env };
}
