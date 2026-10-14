# Task 02 — Project detection and per-project server registry (`src/core/projects.ts`)

> You are a careful junior engineer. This file is self-contained: read it fully, then read ONLY the files it names.
> Do not read other files in the repo and do not change anything outside the files listed under "Files you may edit".

## Ground rules (all tasks)
- Repo: `/home/claude/leanpane-build/obsidian-leanpane` (Node 22, TypeScript 5.5 strict, ES modules, vitest 2). Do NOT run `git commit`/`git add`; the lead commits.
- Edit ONLY the files listed under "Files you may edit". Never edit tests, `src/types.ts`, `docs/`, or another task's file. If a test looks wrong or the spec contradicts it, do not "fix" the test: implement the most reasonable behaviour, and describe the problem in your final report.
- `src/core/*` must NOT import `obsidian` or anything from the browser/DOM. Use Node built-ins with the `node:` prefix (`node:path`, `node:fs/promises`, ...). Use `node:path` functions (never hard-coded `/` or `\\` separators) unless the task says otherwise; code must work on macOS, Linux and Windows.
- Keep the exported names and signatures from the contract below EXACTLY (the lead's integration code and the tests import them). You may add extra exports and private helpers inside your file.
- Replace each `throw new Error("TODO(task 02)")` stub with a real implementation. No `any` unless the contract already has it. No `console.log` in library code.
- Style: 2-space indent, double quotes, semicolons, trailing commas, width ~140. Short comments only where the logic is not obvious.
- Other workers edit other files at the same time. `npx tsc --noEmit` may show errors in files you do not own: ignore them; make sure none are in your file (`npx tsc --noEmit 2>&1 | grep <yourfile>`).

## Test command
```
cd /home/claude/leanpane-build/obsidian-leanpane && npx vitest run --project tasks test/unit/projects.test.ts
```
Run it repeatedly while you work. The task is done when every test in the named file(s) passes (or is skipped by its own `skipIf` for a missing tool) and `tsc` shows no errors in your file.

## Final report (your last message)
Keep it short: files changed; test results (passed/failed/skipped counts); any test you believe is wrong or any ambiguity in this spec, with your reasoning; anything the lead must know for integration.

## Purpose
A Lean *project* is a folder with a `lakefile.toml` or `lakefile.lean`. LeanPane runs exactly ONE language server per project, shared by all open files of the project. Files outside any project use a separate `lean --server` per folder. This module (1) finds the project root for a file, (2) reads facts about it (toolchain, uses Mathlib?), and (3) provides `ProjectRegistry`, which hands out shared servers, starts them lazily after a trust check, and shuts them down after an idle period.

## Files you may edit
- `src/core/projects.ts` (stub). You may read `src/types.ts`, `test/helpers/memfs.ts` and `test/unit/projects.test.ts`.

## Contract (current content of the stub — keep these signatures)
```ts
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
```

Types used (from `src/types.ts`):
```ts
export interface DirFs {
  exists(p: string): Promise<boolean>;
  readFile(p: string): Promise<string>;
  readdir(p: string): Promise<string[]>;
}

export interface ProjectDescriptor {
  /** Absolute project root (folder containing the lakefile). */
  root: string;
  lakefile: "lakefile.toml" | "lakefile.lean";
  /** Contents of `lean-toolchain`, trimmed ("leanprover/lean4:v4.25.1"), or null if the file is missing. */
  toolchain: string | null;
  usesMathlib: boolean;
}

export interface LeanProjectInfo {
  root: string; // vault-relative
  absRoot: string;
  toolchain: string;
  usesMathlib: boolean;
}

/** "stopped": not running, not trying. "starting": spawned, awaiting initialize. "running": initialized.
 *  "backoff": crashed, a restart is scheduled. "failed": gave up after 3 crashes (see `lastError`, `stderrTail`). */
export type ServerState = "stopped" | "starting" | "running" | "backoff" | "failed";

export interface ServerStateEvent {
  state: ServerState;
  /** Set for "backoff"/"failed". */
  error?: string;
  /** 1-based number of consecutive crashes so far. */
  crashes: number;
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

export interface ILeanServer {
  readonly spec: LeanServerSpec;
  readonly state: ServerState;
  /** Set while state === "running" (and kept after a crash until the next successful start). */
  readonly initializeResult: InitializeResult | undefined;
  /** Spawns the process and performs initialize/initialized; resolves when running; rejects if the first start fails. */
  start(): Promise<void>;
  /** Graceful shutdown/exit, then killTree. Cancels any pending restart. State becomes "stopped". Idempotent. */
  stop(): Promise<void>;
  /** stop() then start() with the crash counter reset. */
  restart(): Promise<void>;
  /** LSP request. Rejects with Error if the server is not running or dies. `signal` abort sends $/cancelRequest. */
  request<R = any>(method: string, params: any, signal?: AbortSignal): Promise<R>;
  /** LSP notification; silently dropped when not running. */
  notify(method: string, params: any): void;
  /** Server->client notification subscription. Method "*" receives every notification as (params, method). */
  onNotification(method: string, handler: (params: any, method: string) => void): Disposer;
  /** Server->client request handler (e.g. "workspace/applyEdit"). At most one handler per method. */
  onRequest(method: string, handler: ServerRequestHandler): Disposer;
  /** Fires on every state change, and again after each successful (re)start with state "running". */
  onState(handler: (e: ServerStateEvent) => void): Disposer;
  /** Last N stderr lines of the current/last process (default 40). */
  stderrTail(n?: number): string[];
  /** pid of the current process, if any. */
  readonly pid: number | undefined;
}

export type ServerFactory = (spec: LeanServerSpec) => ILeanServer;

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type Logger = (message: string) => void;
```

## Behaviour — detection
**findProjectRoot(startDir, fs, platform?)** — `startDir` is a directory. Check `startDir`, then each parent, up to the filesystem root. In each folder: if `lakefile.toml` exists → `{root, lakefile: "lakefile.toml"}`; else if `lakefile.lean` exists → `lakefile.lean`. The NEAREST folder wins. Return null at the root. Use `path.win32` when `platform === "win32"`, else `path.posix` (default platform = `process.platform`, but tests pass POSIX paths on any OS, so default to `path.posix` unless `platform === "win32"`; do not use the OS-dependent default `path`).

**parseLeanToolchain(text)** — first line that is non-empty after trim and does not start with `#`; trimmed; else null.

**detectMathlib(lakefile, text)** — strip comments first (`#` to end of line for TOML — but not inside quoted strings; `--` to end of line for lakefile.lean, and `/- ... -/` blocks).
- TOML: true if some `[[require]]` table has `name = "mathlib"` (case-insensitive; single or double quotes) or a `git`/`path` value containing `mathlib4`. A `[[require]]` for another package (e.g. batteries, whose URL does not contain `mathlib4`) is false.
- Lean: true for `require mathlib ...`, `require «mathlib» ...`, `require "leanprover-community" / "mathlib"`, or a `require` line mentioning `mathlib4` (case-insensitive on the package name).

**describeProject(root, lakefile, fs)** — reads `<root>/lakefile` (detectMathlib), `<root>/lean-toolchain` (parseLeanToolchain; null if missing or unreadable). `usesMathlib` is also true when `<root>/lake-manifest.json` parses and has a `packages[].name` equal to `mathlib` (case-insensitive), or when the directory `<root>/.lake/packages/mathlib` exists. Never throw on unreadable files.

**toProjectInfo(d, vaultBase)** — `root`: path of `d.root` relative to `vaultBase`, with `/` separators, `""` when equal (use `path.relative` with the matching flavour: if `vaultBase` contains a backslash or a drive letter treat both as Windows paths); `absRoot = d.root`; `toolchain = d.toolchain ?? ""`; `usesMathlib`.

## Behaviour — ProjectRegistry
Constructor takes `RegistryDeps` (see the stub). Timers default to the global `setTimeout`/`clearTimeout`.

**acquire(fileAbsPath)**:
1. `dir = dirname(fileAbsPath)`; `project = await deps.findProject(dir)`.
2. `key = project ? project.root : "loose:" + dir`.
3. If an entry for `key` exists: reuse it (await its pending start if any), `refs++`, cancel its idle timer.
4. Else: for a project, `await deps.ensureTrusted(project)`; if it resolves false throw `new ProjectNotTrustedError(project)` and create nothing. (Loose files: no trust prompt.) Then create the entry: `server = deps.factory(deps.makeSpec(project, dir))`, store the entry BEFORE awaiting start (so concurrent `acquire` calls for the same key share the entry and the single `server.start()` promise), `refs = 1`.
5. Await `server.start()` if the server is not already `running` (the start promise is shared). If start rejects: remove the entry (so the next acquire can retry) and rethrow.
6. Return a `ServerHandle` whose `release()` is idempotent (second call does nothing): `refs--`; when `refs === 0` and `deps.idleMinutes() > 0`, start an idle timer of `idleMinutes * 60 * 1000` ms. When the timer fires: delete the entry from the registry synchronously, then call `server.stop()` (ignore its rejection).
- `idleMinutes() === 0` → never start a timer.
- Concurrent `ensureTrusted` calls for the same key must not both prompt: store the entry (with a promise) before awaiting the trust check, or keep a per-key pending map.

**peek(key)** → the entry's server or undefined. **entries()** → snapshot array. **dispose()** → clear all timers, delete all entries, `await Promise.all(servers.map(s => s.stop()))`.

## Tests
`test/unit/projects.test.ts` (uses an in-memory filesystem and a fake server). Definition of done.
