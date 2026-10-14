# Task 07 — Whole-project declaration status query (`src/core/statusQuery.ts`)

> You are a careful junior engineer. This file is self-contained: read it fully, then read ONLY the files it names.
> Do not read other files in the repo and do not change anything outside the files listed under "Files you may edit".

## Ground rules (all tasks)
- Repo: `/home/claude/leanpane-build/obsidian-leanpane` (Node 22, TypeScript 5.5 strict, ES modules, vitest 2). Do NOT run `git commit`/`git add`; the lead commits.
- Edit ONLY the files listed under "Files you may edit". Never edit tests, `src/types.ts`, `docs/`, or another task's file. If a test looks wrong or the spec contradicts it, do not "fix" the test: implement the most reasonable behaviour, and describe the problem in your final report.
- `src/core/*` must NOT import `obsidian` or anything from the browser/DOM. Use Node built-ins with the `node:` prefix (`node:path`, `node:fs/promises`, ...). Use `node:path` functions (never hard-coded `/` or `\\` separators) unless the task says otherwise; code must work on macOS, Linux and Windows.
- Keep the exported names and signatures from the contract below EXACTLY (the lead's integration code and the tests import them). You may add extra exports and private helpers inside your file.
- Replace each `throw new Error("TODO(task 07)")` stub with a real implementation. No `any` unless the contract already has it. No `console.log` in library code.
- Style: 2-space indent, double quotes, semicolons, trailing commas, width ~140. Short comments only where the logic is not obvious.
- Other workers edit other files at the same time. `npx tsc --noEmit` may show errors in files you do not own: ignore them; make sure none are in your file (`npx tsc --noEmit 2>&1 | grep <yourfile>`).

## Test command
```
cd /home/claude/leanpane-build/obsidian-leanpane && npx vitest run --project tasks test/unit/statusQuery.test.ts test/lean/statusQuery.test.ts
```
Run it repeatedly while you work. The task is done when every test in the named file(s) passes (or is skipped by its own `skipIf` for a missing tool) and `tsc` shows no errors in your file.

## Final report (your last message)
Keep it short: files changed; test results (passed/failed/skipped counts); any test you believe is wrong or any ambiguity in this spec, with your reasoning; anything the lead must know for integration.

## Purpose
After `lake build`, LeanPane wants the truth about named declarations (the names in a blueprint's `\lean{...}`): does it exist, is it proved, does it use `sorry` — directly or through a lemma it depends on? The lead already wrote and verified a small Lean program (`STATUS_QUERY_LEAN` in `src/core/statusQuery.lean.ts`) which imports the project's modules at run time and prints one JSON line per name. Your job is the TypeScript side: find the right modules, write the program to a temp file, run it with `lake env lean --run`, parse the output, and map each record to a `DeclStatus`.

## Files you may edit
- `src/core/statusQuery.ts` (stub). May read: `src/types.ts`, `src/core/statusQuery.lean.ts` (the Lean program; read its header comment and `main` to see the command line and JSON fields; do NOT edit it), `src/core/nodeio.ts` (real `defaultExec`), both test files.

## Contract (current content of the stub — keep these signatures)
```ts
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
```

Types used (from `src/types.ts` and `src/integration/api-types.ts`):
```ts
export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Run a program to completion. Rejects only when the program cannot be started (ENOENT); non-zero exit is a result. */
export type ExecFn = (file: string, args: string[], opts?: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number }

/** One JSON line printed by the Lean query program (src/core/statusQuery.lean.ts) in `status` mode. */
export interface QueryRecord {
  name: string;
  exists: boolean;
  module?: string;
  line?: number | null;
  kind?: string;
  type?: string;
  ownSorry?: boolean;
  anySorry?: boolean;
  /** Set when the query program failed on this name. */
  error?: string;
}

export type DeclState = "missing" | "error" | "stated" | "proved-with-sorry-deps" | "proved" | "mathlib" | "unknown";

export interface DeclStatus {
  name: string;
  state: DeclState;
  file?: string;
  line?: number;
  kind?: string;
  signature?: string;
  source: "live" | "build" | "none";
  updatedAt: number;
}

export interface DeclSummary {
  name: string;
  kind: string;
  file: string;
  line: number;
}
```

(`DeclState` = `"missing" | "error" | "stated" | "proved-with-sorry-deps" | "proved" | "mathlib" | "unknown"`; `DeclStatus` = `{ name, state, file?, line?, kind?, signature?, source: "live" | "build" | "none", updatedAt }`; `DeclSummary` = `{ name, kind, file, line }`.)

## How the Lean program is called
`lake env lean --run <queryFile> status <Mod1,Mod2,...> <Name1> <Name2> ...` run with cwd = project root and an env whose PATH contains the elan bin dir. Stdout: one JSON object per line (but Lean may also print warnings to stdout: ignore every line that is not a JSON object). Exit code 0 = ok; 3 = importing the modules failed (stderr says why); other non-zero = the program itself failed.
Record fields (`QueryRecord`): `name`, `exists`; when it exists also `module`, `line` (number or null), `kind` (`theorem|def|axiom|opaque|inductive|constructor|recursor|quot`), `type` (pretty-printed, truncated), `ownSorry`, `anySorry` (true if `sorryAx` is among the transitive axioms), or `error`.
`list` mode: `... lean --run <queryFile> list <Mods> [prefix]` prints `{name, module, kind, line}` per declaration of the given modules (internal/private names excluded).

## Behaviour
**discoverModules(projectRoot)** — recursively collect `*.lean` files under `projectRoot`, skipping any directory whose name starts with `.` (so `.lake`), and the file `lakefile.lean` (keep every other `.lean` file, e.g. `Main.lean`, if it is built). A file `A/B/C.lean` is module `A.B.C`; keep it only if `<root>/.lake/build/lib/lean/A/B/C.olean` exists. Result sorted alphabetically (plain string compare). Missing/unreadable directories → ignore. (Reason: a module with an error has no .olean; importing it would make the whole query fail.)

**moduleToFile(projectRoot, module)** — `A.B.C` → `<root>/A/B/C.lean` if that file exists (sync `fs.existsSync`); else search `<root>/.lake/packages/*/A/B/C.lean`; else `undefined`.

**ensureQueryFile(dir = os.tmpdir())** — file name `leanpane-status-query-<first 12 hex of sha256(STATUS_QUERY_LEAN)>.lean` in `dir`; write the program if the file does not exist or has different content; return the path. Idempotent and safe to call concurrently (write to a temp name, then rename).

**parseQueryOutput(stdout)** — split on `\n` (CRLF-safe); for lines whose trimmed text starts with `{`, `JSON.parse` in try/catch (skip failures) and keep objects having a string `name`.

**recordToStatus(rec, now, resolve?)** — returns `{ name, state, source: "build", updatedAt: now, ...optional fields }`:
1. `rec.error` set → state `"unknown"`, source `"none"`.
2. `!rec.exists` → `"missing"` (no other fields).
3. `rec.ownSorry` → `"stated"`; else `rec.anySorry` → `"proved-with-sorry-deps"`; else module is `Mathlib` or starts with `Mathlib.` → `"mathlib"`; else `"proved"`.
Optional fields for existing declarations: `kind`, `line` (only if a number), `signature` = `rec.type`, `file` = `resolve?.(rec.module)` (only when defined). Do not set keys whose value is undefined.

**runStatusQuery(opts)** — returns a record with EXACTLY one entry per requested name:
- `modules = opts.modules ?? await discoverModules(projectRoot)`. If empty → every name `{ state: "unknown", source: "none", updatedAt }` without running anything.
- Write/locate the query file; process names in chunks of 100 sequentially (command lines have length limits); `exec = opts.exec ?? defaultExec`, `timeoutMs = opts.timeoutMs ?? 120000`; command `opts.lakePath` with args `["env","lean","--run",queryFile,"status",modules.join(","),...chunk]`, `cwd: projectRoot`, `env: opts.env`. Check `opts.signal?.aborted` between chunks (stop early; remaining names `unknown`).
- Exit code ≠ 0 or spawn failure (`exec` rejects) → all names of that chunk are `unknown` (source `"none"`). Names without a record in the output → `unknown`. Never throw.
- Use `moduleToFile.bind(null, projectRoot)` as the resolver. `updatedAt = Date.now()`.

**runListQuery(opts)** — same invocation with `list`, modules, and `opts.prefix ?? ""` as the last argument. Returns `DeclSummary[]`: `name`, `kind`, `file` = `moduleToFile(...)` or, when not resolvable, the relative path `A/B/C.lean` built from the module, `line` = number or 0. Sorted by file, then line, then name. Failures → `[]`.

## Tests
`test/unit/statusQuery.test.ts` (pure + temp dirs) and `test/lean/statusQuery.test.ts` (real Lean 4.25.1 on `test/fixtures/lean/status_proj`, already built; skips itself if Lean is missing). Definition of done: both pass.
