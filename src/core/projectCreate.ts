/**
 * "New Lean project": `lake new` (optionally the Mathlib template + cache download) and the blueprint skeleton.
 * Pure Node (no "obsidian"); all process execution goes through an injectable RunFn.
 */
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { blueprintFiles, lakeNewArgs, libNameFor, MATHLIB_CACHE_ARGS, sanitizeProjectName, starterLeanFile } from "./templates";
import { runStreaming, type RunFn } from "./runner";

export interface CreateProjectOptions {
  /** Absolute folder the project folder is created in. */
  parentDir: string;
  name: string;
  mathlib: boolean;
  blueprint: boolean;
  lakePath: string;
  env: NodeJS.ProcessEnv;
  run?: RunFn;
  signal?: AbortSignal;
  /** Progress lines for the progress modal (process output and our own step headings). */
  onLog?: (text: string) => void;
}
export interface CreateProjectResult {
  root: string;
  libName: string;
  /** The .lean file to open first (starter theorem with a blueprint, else the library's Basic.lean / root file). */
  mainLean: string;
  /** blueprint/src/content.tex when a blueprint was requested. */
  contentTex?: string;
  warnings: string[];
}

export class ProjectCreateError extends Error {}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Library name declared in the lakefile (`[[lean_lib]] name = "X"`), else the name `lake new` would derive. */
export async function libNameOf(root: string, projectName: string): Promise<string> {
  try {
    const toml = await fsp.readFile(path.join(root, "lakefile.toml"), "utf8");
    const m = /\[\[lean_lib\]\][^\[]*?name\s*=\s*"([^"]+)"/.exec(toml);
    if (m) return m[1];
  } catch {
    /* lakefile.lean template or unreadable: fall back */
  }
  return libNameFor(projectName);
}

export async function createLeanProject(o: CreateProjectOptions): Promise<CreateProjectResult> {
  const run = o.run ?? runStreaming;
  const log = o.onLog ?? (() => undefined);
  const name = sanitizeProjectName(o.name);
  if (!name) throw new ProjectCreateError("Please enter a project name (letters, digits, - and _).");
  const root = path.join(o.parentDir, name);
  if (await exists(root)) throw new ProjectCreateError(`"${name}" already exists in that folder.`);
  await fsp.mkdir(o.parentDir, { recursive: true });
  const warnings: string[] = [];

  const step = async (title: string, args: string[], cwd: string): Promise<number | null> => {
    log(`\n$ lake ${args.join(" ")}\n`);
    log(`(${title})\n`);
    const res = await run(o.lakePath, args, { cwd, env: o.env, signal: o.signal, onOutput: (t) => log(t) });
    if (res.cancelled) throw new ProjectCreateError("Cancelled.");
    return res.code;
  };

  const code = await step(o.mathlib ? "creating a project from the Mathlib template" : "creating the project", lakeNewArgs({ name, mathlib: o.mathlib }), o.parentDir);
  if (code !== 0 || !(await exists(path.join(root, "lean-toolchain")))) {
    throw new ProjectCreateError(`lake new failed (exit code ${code ?? "none"}). See the output above.`);
  }

  const libName = await libNameOf(root, name);

  if (o.mathlib) {
    const c = await step("downloading the prebuilt Mathlib cache; this can take several minutes", MATHLIB_CACHE_ARGS, root);
    if (c !== 0) warnings.push("The Mathlib cache download failed. Run \"Fetch Mathlib cache\" later, or Lean will compile Mathlib itself (very slow).");
  }

  let mainLean = path.join(root, libName, "Basic.lean");
  if (!(await exists(mainLean))) mainLean = path.join(root, `${libName}.lean`);
  let contentTex: string | undefined;

  if (o.blueprint) {
    log("\nAdding the blueprint skeleton\n");
    const starter = starterLeanFile(libName);
    const put = async (rel: string, content: string): Promise<void> => {
      const abs = path.join(root, ...rel.split("/"));
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, content, "utf8");
    };
    for (const f of blueprintFiles({ projectName: name, libName })) await put(f.path, f.content);
    await put(starter.path, starter.content);
    const rootFile = path.join(root, `${libName}.lean`);
    let rootText = "";
    try {
      rootText = await fsp.readFile(rootFile, "utf8");
    } catch {
      /* no root file yet */
    }
    const importLine = `import ${starter.module}`;
    if (!rootText.split(/\r?\n/).some((l) => l.trim() === importLine)) {
      await fsp.writeFile(rootFile, rootText + (rootText === "" || rootText.endsWith("\n") ? "" : "\n") + importLine + "\n", "utf8");
    }
    mainLean = path.join(root, ...starter.path.split("/"));
    contentTex = path.join(root, "blueprint", "src", "content.tex");
  }

  const result: CreateProjectResult = { root, libName, mainLean, warnings };
  if (contentTex) result.contentTex = contentTex;
  return result;
}
