# Task 03 — Lean language-server client (`src/core/server.ts`)

> You are a careful junior engineer. This file is self-contained: read it fully, then read ONLY the files it names.
> Do not read other files in the repo and do not change anything outside the files listed under "Files you may edit".

## Ground rules (all tasks)
- Repo: `/home/claude/leanpane-build/obsidian-leanpane` (Node 22, TypeScript 5.5 strict, ES modules, vitest 2). Do NOT run `git commit`/`git add`; the lead commits.
- Edit ONLY the files listed under "Files you may edit". Never edit tests, `src/types.ts`, `docs/`, or another task's file. If a test looks wrong or the spec contradicts it, do not "fix" the test: implement the most reasonable behaviour, and describe the problem in your final report.
- `src/core/*` must NOT import `obsidian` or anything from the browser/DOM. Use Node built-ins with the `node:` prefix (`node:path`, `node:fs/promises`, ...). Use `node:path` functions (never hard-coded `/` or `\\` separators) unless the task says otherwise; code must work on macOS, Linux and Windows.
- Keep the exported names and signatures from the contract below EXACTLY (the lead's integration code and the tests import them). You may add extra exports and private helpers inside your file.
- Replace each `throw new Error("TODO(task 03)")` stub with a real implementation. No `any` unless the contract already has it. No `console.log` in library code.
- Style: 2-space indent, double quotes, semicolons, trailing commas, width ~140. Short comments only where the logic is not obvious.
- Other workers edit other files at the same time. `npx tsc --noEmit` may show errors in files you do not own: ignore them; make sure none are in your file (`npx tsc --noEmit 2>&1 | grep <yourfile>`).

## Test command
```
cd /home/claude/leanpane-build/obsidian-leanpane && npx vitest run --project tasks test/unit/server.fake.test.ts test/lean/server.test.ts
```
Run it repeatedly while you work. The task is done when every test in the named file(s) passes (or is skipped by its own `skipIf` for a missing tool) and `tsc` shows no errors in your file.

## Final report (your last message)
Keep it short: files changed; test results (passed/failed/skipped counts); any test you believe is wrong or any ambiguity in this spec, with your reasoning; anything the lead must know for integration.

## Purpose
`LeanServer` owns ONE child process (`lake serve --` in a project, or `lean --server`), speaks LSP/JSON-RPC to it over stdio, and keeps it alive: crash → automatic restart with backoff → give up after 3 crashes. It is the lowest layer of LeanPane; everything else (documents, goals, diagnostics) goes through it. It is used inside Obsidian (Electron renderer, Node APIs available) — but this file must not import `obsidian`.

## Files you may edit
- `src/core/server.ts` (stub). You may read: `src/types.ts`, `src/core/proc.ts` (`killTree`, `pidAlive` — already written, use them), `test/helpers/fake-lsp.mjs` + `test/helpers/fakeServer.ts` (fake LSP server used by the tests), `test/helpers/lean.ts` (see `startRawServer` for a working handshake with the real Lean), and the two test files.

## Contract (current content of the stub — keep these signatures)
```ts
/**
 * JSON-RPC client for one Lean language server process. Pure Node (no "obsidian"). TASK: docs/tasks/03-server.md
 */
import type { Disposer, ILeanServer, InitializeResult, LeanServerSpec, Logger, ServerRequestHandler, ServerState, ServerStateEvent, TimerApi } from "../types";

export interface LeanServerOptions {
  /** Project root (or folder for a loose file); used for rootUri and workspaceFolders. Default spec.cwd. */
  rootPath?: string;
  /** Delay before restart after crash #1, #2, … (last value repeats). Default [1000, 5000, 30000]. */
  backoffMs?: number[];
  /** Crashes after which state becomes "failed". Default 3. */
  maxCrashes?: number;
  /** A process that lived at least this long counts as a fresh start for the crash counter. Default 60000. */
  stableMs?: number;
  /** Give up waiting for the initialize response after this long. Default 120000. */
  initTimeoutMs?: number;
  /** Extra `initializationOptions` merged over { hasWidgets: true, editDelay: 50 }. */
  initializationOptions?: Record<string, unknown>;
  log?: Logger;
  timers?: TimerApi;
}

export class LeanServer implements ILeanServer {
  readonly spec: LeanServerSpec;
  state: ServerState = "stopped";
  initializeResult: InitializeResult | undefined;
  pid: number | undefined;

  constructor(spec: LeanServerSpec, _opts: LeanServerOptions = {}) {
    this.spec = spec;
  }
  start(): Promise<void> {
    throw new Error("TODO(task 03)");
  }
  stop(): Promise<void> {
    throw new Error("TODO(task 03)");
  }
  restart(): Promise<void> {
    throw new Error("TODO(task 03)");
  }
  request<R = any>(_method: string, _params: any, _signal?: AbortSignal): Promise<R> {
    throw new Error("TODO(task 03)");
  }
  notify(_method: string, _params: any): void {
    throw new Error("TODO(task 03)");
  }
  onNotification(_method: string, _handler: (params: any, method: string) => void): Disposer {
    throw new Error("TODO(task 03)");
  }
  onRequest(_method: string, _handler: ServerRequestHandler): Disposer {
    throw new Error("TODO(task 03)");
  }
  onState(_handler: (e: ServerStateEvent) => void): Disposer {
    throw new Error("TODO(task 03)");
  }
  stderrTail(_n?: number): string[] {
    throw new Error("TODO(task 03)");
  }
}
```

Types used (from `src/types.ts`):
```ts
export type Disposer = () => void;

export type Logger = (message: string) => void;

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** "stopped": not running, not trying. "starting": spawned, awaiting initialize. "running": initialized.
 *  "backoff": crashed, a restart is scheduled. "failed": gave up after 3 crashes (see `lastError`, `stderrTail`). */
export type ServerState = "stopped" | "starting" | "running" | "backoff" | "failed";

export interface LeanServerSpec {
  kind: "lake" | "lean";
  /** Absolute path (or bare name resolved through env PATH) of lake / lean. */
  command: string;
  /** e.g. ["serve", "--"] for lake or ["--server"] for lean. */
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface ServerStateEvent {
  state: ServerState;
  /** Set for "backoff"/"failed". */
  error?: string;
  /** 1-based number of consecutive crashes so far. */
  crashes: number;
}

/** Return the response result (or throw). Unhandled server->client requests are answered with `null`. */
export type ServerRequestHandler = (params: any) => unknown | Promise<unknown>;

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
```

## Libraries
`vscode-jsonrpc` is installed. Use its Node entry: `import * as rpc from "vscode-jsonrpc/node";` → `rpc.createMessageConnection(new rpc.StreamMessageReader(child.stdout), new rpc.StreamMessageWriter(child.stdin))`, `connection.listen()`, `sendRequest(method, params, token?)`, `sendNotification`, `onNotification(handler)` / `onRequest(handler)` (the catch-all forms that receive the method name), `rpc.CancellationTokenSource` (cancelling a token makes the library send `$/cancelRequest`). LSP types come from `import type { InitializeResult } from "vscode-languageserver-protocol"` (types only; already re-exported by `src/types.ts`).

## Behaviour
**Spawning** — `child_process.spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, shell: false, stdio: ["pipe","pipe","pipe"], detached: process.platform !== "win32", windowsHide: true })`. `detached` gives the child its own process group so `killTree` (already implemented in `src/core/proc.ts`) can kill `lake` AND the `lean` worker processes it spawns. Listen to the child's `error` (e.g. ENOENT) and `exit` events. Capture stderr lines in a ring buffer (keep the last ~200 lines; `stderrTail(n=40)` returns the last n). Also pass each stderr line to `opts.log` if given. `pid` is the child's pid while it runs, else undefined.

**Handshake** — after spawn: `initialize` request with
```ts
{ processId: process.pid, clientInfo: { name: "LeanPane", version: "0.1.0" },
  rootUri: <file URI of rootPath>, workspaceFolders: [{ uri, name: basename(rootPath) }],
  capabilities: {
    textDocument: { synchronization: { didSave: true }, publishDiagnostics: { relatedInformation: true },
      documentSymbol: { hierarchicalDocumentSymbolSupport: true }, hover: { contentFormat: ["markdown","plaintext"] },
      completion: { completionItem: { snippetSupport: false } }, definition: {}, semanticTokens: { requests: { full: true, range: true }, tokenTypes: [], tokenModifiers: [], formats: ["relative"] } },
    window: { workDoneProgress: true, showDocument: { support: true } },
    workspace: { semanticTokens: { refreshSupport: true }, applyEdit: true, workspaceFolders: true },
    experimental: {} },
  initializationOptions: { hasWidgets: true, editDelay: 50, ...opts.initializationOptions } }
```
then the `initialized` notification. File URIs: `pathToFileURL(rootPath).toString()` from `node:url`. Store `initializeResult`. `state` becomes `"running"` and listeners get `{ state: "running", crashes }`. Wait at most `initTimeoutMs` for the `initialize` response (default 120000: the first start may make elan download a toolchain).

**States** (emit `ServerStateEvent` to `onState` listeners on EVERY change; `crashes` = the current consecutive-crash count):
- `stopped` → `start()` → `starting` → (handshake ok) `running`.
- Handshake failure (process exits before the response, spawn error, timeout): kill the process tree, state `failed` (with `error` = message incl. the last stderr lines), `start()` REJECTS with an Error whose message contains that text (e.g. "Lean server exited (code 3) during startup: fake boot failure"). No automatic retry for a failed FIRST start.
- A running process exits without `stop()` having been called = crash: `crashes++`; reject all pending requests; clear `pid`. If `crashes >= maxCrashes` (default 3) → state `failed` (error mentions the exit code and stderr tail); else state `backoff` and, after `backoffMs[min(crashes-1, len-1)]` ms (default `[1000, 5000, 30000]`), spawn again: `starting` → `running`. A restart attempt whose handshake fails counts as another crash (same rules). If the dead process had lived ≥ `stableMs` (default 60000) before crashing, reset `crashes` to 0 before counting this one.
- After an automatic restart reaches `running`, listeners are told with a `running` event (the integration layer re-sends `didOpen` for open documents on that event). `start()`'s promise belongs to the FIRST start only.
- `stop()` — idempotent. Cancel a pending backoff timer. If a process is running: try `shutdown` request (wait ≤ 1.5 s), then `exit` notification, wait ≤ 1.5 s for the process to exit; ALWAYS finish with `killTree(child)` (it kills the group; harmless if already gone) and wait until the `exit` event fired or ~3 s passed. Dispose the connection. Reject pending requests. Final state `stopped` (event emitted once). `stop()` must work in any state, including `starting` and `backoff`.
- `restart()` = `stop()` then reset `crashes = 0` then `start()`.
- `start()` when already `running`/`starting` returns the same promise / resolves immediately. From `failed` or `stopped` it starts afresh with `crashes = 0`.

**request(method, params, signal?)** — if the state is not `running`, reject immediately with `Error("Lean server is not running")`. If `signal` aborts: cancel through the token (the library sends `$/cancelRequest`) and reject the returned promise (any rejection is fine; tests only check that it rejects and the server stays usable). Pending requests are rejected when the process dies.
**notify** — dropped silently when not running.
**onNotification(method, handler)** — `method === "*"` receives every server notification; otherwise only that method. Handler gets `(params, method)`. Exceptions thrown by handlers must be caught (never break the read loop). Returns a disposer. Subscriptions survive restarts.
**onRequest(method, handler)** — server→client requests. Register one catch-all `connection.onRequest((method, params) => ...)`: if a handler is registered for the method, return its result (await it); otherwise return `null` (Lean sends `client/registerCapability`, `window/workDoneProgress/create`, `workspace/semanticTokens/refresh`, … and blocks if unanswered). At most one handler per method (later registration replaces). Returns a disposer.
**onState** — returns a disposer; listener exceptions are swallowed.

## Edge cases and hints
- Make sure the `exit` handler of an OLD process never affects the state of a NEW process (compare against the current child, or use a generation counter).
- Use `opts.timers` (default global) for the backoff delay so tests could inject fake timers; the provided tests use tiny real delays instead.
- Writing to a dead process's stdin can emit EPIPE errors: attach `child.stdin.on("error", () => {})`.
- A missing executable (`spawn ... ENOENT`) must surface as a rejected `start()` with a helpful message ("Could not start <command>: <error>") and state `failed`.
- Do not leave timers running after `stop()` (the vitest worker must be able to exit).
- The real-Lean test file takes a few seconds; it kills the process with SIGKILL to test crash recovery.

## Tests
`test/unit/server.fake.test.ts` (fake LSP process; fast) and `test/lean/server.test.ts` (real `lake serve` on `test/fixtures/lean/status_proj`; skips itself if Lean is missing). Both must pass.
