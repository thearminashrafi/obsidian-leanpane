# Task 01 — Elan / Lean toolchain discovery (`src/core/elan.ts`)

> You are a careful junior engineer. This file is self-contained: read it fully, then read ONLY the files it names.
> Do not read other files in the repo and do not change anything outside the files listed under "Files you may edit".

## Ground rules (all tasks)
- Repo: `/home/claude/leanpane-build/obsidian-leanpane` (Node 22, TypeScript 5.5 strict, ES modules, vitest 2). Do NOT run `git commit`/`git add`; the lead commits.
- Edit ONLY the files listed under "Files you may edit". Never edit tests, `src/types.ts`, `docs/`, or another task's file. If a test looks wrong or the spec contradicts it, do not "fix" the test: implement the most reasonable behaviour, and describe the problem in your final report.
- `src/core/*` must NOT import `obsidian` or anything from the browser/DOM. Use Node built-ins with the `node:` prefix (`node:path`, `node:fs/promises`, ...). Use `node:path` functions (never hard-coded `/` or `\\` separators) unless the task says otherwise; code must work on macOS, Linux and Windows.
- Keep the exported names and signatures from the contract below EXACTLY (the lead's integration code and the tests import them). You may add extra exports and private helpers inside your file.
- Replace each `throw new Error("TODO(task 01)")` stub with a real implementation. No `any` unless the contract already has it. No `console.log` in library code.
- Style: 2-space indent, double quotes, semicolons, trailing commas, width ~140. Short comments only where the logic is not obvious.
- Other workers edit other files at the same time. `npx tsc --noEmit` may show errors in files you do not own: ignore them; make sure none are in your file (`npx tsc --noEmit 2>&1 | grep <yourfile>`).

## Test command
```
cd /home/claude/leanpane-build/obsidian-leanpane && npx vitest run --project tasks test/unit/elan.test.ts test/lean/elan.real.test.ts
```
Run it repeatedly while you work. The task is done when every test in the named file(s) passes (or is skipped by its own `skipIf` for a missing tool) and `tsc` shows no errors in your file.

## Final report (your last message)
Keep it short: files changed; test results (passed/failed/skipped counts); any test you believe is wrong or any ambiguity in this spec, with your reasoning; anything the lead must know for integration.

## Purpose
LeanPane launches `lake serve` (Lean's language server). Lean is installed by *elan*, whose shims live in `~/.elan/bin`. GUI apps such as Obsidian on macOS do not inherit the shell PATH, so we must find elan ourselves and put its directory in front of PATH for every child process. This module finds the shims, reads their versions, lists installed toolchains, builds the child environment, and builds the launch spec for a server.

## Files you may edit
- `src/core/elan.ts` (currently a stub; keep its header comment and the `export { defaultExec, nodeFs } from "./nodeio";` line).
Files you may read: `src/types.ts`, `src/core/nodeio.ts` (real `ExecFn`/`DirFs` implementations), `test/helpers/memfs.ts`, the two test files.

## Contract (current content of the stub — keep these signatures)
```ts
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
```

Types used (from `src/types.ts`):
```ts
export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Run a program to completion. Rejects only when the program cannot be started (ENOENT); non-zero exit is a result. */
export type ExecFn = (file: string, args: string[], opts?: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number }

export interface DirFs {
  exists(p: string): Promise<boolean>;
  readFile(p: string): Promise<string>;
  readdir(p: string): Promise<string[]>;
}

export interface ElanInfo {
  /** Directory that contains the elan shims (prepended to PATH for children); null when nothing was found (use PATH as is). */
  binDir: string | null;
  /** Absolute path of `lake`, or null when not found. */
  lakePath: string | null;
  leanPath: string | null;
  elanPath: string | null;
  /** "elan 4.2.4 (…)" first line, when probed. */
  elanVersion?: string;
  /** "Lake version 5.0.0-src+… (Lean version 4.25.1)" first line, when probed. */
  lakeVersion?: string;
  /** Output of `elan toolchain list`, one name per entry, "(default)" suffix removed. */
  toolchains: string[];
  defaultToolchain?: string;
}

export interface ProjectDescriptor {
  /** Absolute project root (folder containing the lakefile). */
  root: string;
  lakefile: "lakefile.toml" | "lakefile.lean";
  /** Contents of `lean-toolchain`, trimmed ("leanprover/lean4:v4.25.1"), or null if the file is missing. */
  toolchain: string | null;
  usesMathlib: boolean;
}

export interface LeanServerSpec {
  kind: "lake" | "lean";
  /** Absolute path (or bare name resolved through env PATH) of lake / lean. */
  command: string;
  /** e.g. ["serve", "--"] for lake or ["--server"] for lean. */
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}
```

## Behaviour
**elanCandidateDirs** — ordered, de-duplicated list of directories that may contain `elan`, `lake`, `lean`:
1. `settingsDir` if non-empty (Settings override).
2. `<home>/.elan/bin` (Windows: `<home>\.elan\bin`, where `home` is the USERPROFILE-like value passed in).
3. Every entry of the PATH variable (`:` separated; Windows `;`, and on Windows the variable name is matched case-insensitively: `Path`/`PATH`). Ignore empty entries.
Use `path.win32` for `platform === "win32"` and `path.posix` otherwise, so the function is testable on any OS.

**discoverElan** — defaults: `platform = process.platform`, `env = process.env`, `home = os.homedir()`, `fs = nodeFs`, `exec = defaultExec`, `probe = true`.
- Walk the candidate dirs in order; for each of `elan`, `lake`, `lean` (Windows: `.exe`, `.bat`, `.cmd` extensions tried) take the FIRST candidate dir containing it (check with `fs.exists`). `binDir` = the dir where `lake` was found, else where `lean`, else where `elan` was found, else `null`.
- Fill `elanPath`, `lakePath`, `leanPath` (absolute) or `null`.
- If `probe` is true, run (with `exec`, env = `buildEnv({binDir}, env)`, `timeoutMs` 8000): `elan --version` (first non-empty stdout line → `elanVersion`), `lake --version` (first line → `lakeVersion`), `elan toolchain list` (→ `parseToolchainList`). Only run a probe when the corresponding binary was found (call it by its absolute path). A probe that throws or exits non-zero leaves the field `undefined` (and `toolchains: []`); it must never make `discoverElan` throw.
- `toolchains` is always an array. `defaultToolchain` only when elan marks one.

**buildEnv** — returns a NEW object; `PATH` = `binDir + sep + existing PATH`; no change when `binDir` is null. Idempotent: if `binDir` is already the first entry, do not add it again. On Windows keep the existing key's spelling (e.g. `Path`) and use `;`. If there is no PATH at all, PATH = `binDir`. Do not touch other variables.

**parseToolchainList** — input is the output of `elan toolchain list`. One toolchain per non-empty line; strip a trailing `(default)` (and `(override)`, `(resolved ...)`-style parenthesised suffixes) and whitespace; remember the one that carried `(default)`. The text `no installed toolchains` (any case) means none. Handle CRLF.

**toolchainDownloadHint(toolchain, installed)** — `null` when `toolchain` is null or is installed. "Installed" compares after normalisation: trim; strip a leading `leanprover/lean4:`; so `v4.25.1` equals `leanprover/lean4:v4.25.1`. Channels such as `stable`/`nightly` match by plain equality. Otherwise return exactly `Preparing Lean (may download <toolchain>)…` (with the original toolchain string and the Unicode ellipsis).

**makeServerSpec(info, project, dirForLoose, baseEnv, platform)**
- With a project: `{ kind: "lake", command: info.lakePath ?? "lake", args: ["serve", "--"], cwd: project.root, env: buildEnv(info, baseEnv, platform) }`.
- Without: `{ kind: "lean", command: info.leanPath ?? "lean", args: ["--server"], cwd: dirForLoose, env: ... }`.

## Edge cases
- Directories listed in PATH that do not exist: `fs.exists` returns false — just skip.
- Never throw from `discoverElan` for missing tools; return the nulls.

## Tests
`test/unit/elan.test.ts` (pure, fakes) and `test/lean/elan.real.test.ts` (uses the real elan if present; it skips itself otherwise). Read them: they are the definition of done.
