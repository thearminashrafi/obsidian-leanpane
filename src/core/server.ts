/**
 * JSON-RPC client for one Lean language server process. Pure Node (no "obsidian"). TASK: docs/tasks/03-server.md
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
import * as rpc from "vscode-jsonrpc/node";
import type { Disposer, ILeanServer, InitializeResult, LeanServerSpec, Logger, ServerRequestHandler, ServerState, ServerStateEvent, TimerApi } from "../types";
import { killTree } from "./proc";

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

const STDERR_KEEP = 200;

const defaultTimers: TimerApi = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

interface Handshake {
  gen: number;
  /** true when this is an automatic restart (a failure counts as a crash) */
  auto: boolean;
  timer?: unknown;
  resolve: () => void;
  reject: (e: Error) => void;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Resolves when `p` settles or after `ms`, whichever comes first. Never leaves a timer behind. */
function within(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(t);
      resolve();
    };
    p.then(done, done);
  });
}

function exitWithin(child: ChildProcess, ms: number): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return within(new Promise<void>((resolve) => child.once("exit", () => resolve())), ms);
}

export class LeanServer implements ILeanServer {
  readonly spec: LeanServerSpec;
  state: ServerState = "stopped";
  initializeResult: InitializeResult | undefined;
  pid: number | undefined;

  private readonly rootPath: string;
  private readonly backoffMs: number[];
  private readonly maxCrashes: number;
  private readonly stableMs: number;
  private readonly initTimeoutMs: number;
  private readonly initOptions: Record<string, unknown>;
  private readonly log: Logger | undefined;
  private readonly timers: TimerApi;

  private child: ChildProcess | undefined;
  private conn: rpc.MessageConnection | undefined;
  private gen = 0;
  private startedAt = 0;
  private crashes = 0;
  private stopping = false;
  private stopPromise: Promise<void> | undefined;
  private handshake: Handshake | undefined;
  private handshakePromise: Promise<void> | undefined;
  private backoffTimer: { handle: unknown } | undefined;
  private readonly stateListeners = new Set<(e: ServerStateEvent) => void>();
  private readonly notifListeners = new Map<string, Set<(params: any, method: string) => void>>();
  private readonly requestHandlers = new Map<string, ServerRequestHandler>();
  /** reject functions of in-flight requests, called when the process dies or is stopped */
  private readonly pending = new Set<(err: Error) => void>();
  private readonly stderrLines: string[] = [];

  constructor(spec: LeanServerSpec, opts: LeanServerOptions = {}) {
    this.spec = spec;
    this.rootPath = opts.rootPath ?? spec.cwd;
    this.backoffMs = opts.backoffMs ?? [1000, 5000, 30000];
    this.maxCrashes = opts.maxCrashes ?? 3;
    this.stableMs = opts.stableMs ?? 60000;
    this.initTimeoutMs = opts.initTimeoutMs ?? 120000;
    this.initOptions = opts.initializationOptions ?? {};
    this.log = opts.log;
    this.timers = opts.timers ?? defaultTimers;
  }

  start(): Promise<void> {
    if (this.stopPromise) return this.stopPromise.then(() => this.start());
    if (this.state === "running") return Promise.resolve();
    if (this.state === "starting") return this.handshakePromise ?? Promise.resolve();
    this.cancelBackoff();
    this.crashes = 0;
    this.stopping = false;
    return this.launch(false);
  }

  stop(): Promise<void> {
    if (this.state === "stopped" && !this.child && !this.handshake && !this.backoffTimer) return Promise.resolve();
    if (!this.stopPromise) {
      this.stopPromise = this.doStop().finally(() => {
        this.stopPromise = undefined;
      });
    }
    return this.stopPromise;
  }

  async restart(): Promise<void> {
    await this.stop();
    this.crashes = 0;
    return this.start();
  }

  request<R = any>(method: string, params: any, signal?: AbortSignal): Promise<R> {
    const conn = this.conn;
    if (this.state !== "running" || !conn) return Promise.reject(new Error("Lean server is not running"));
    const cts = new rpc.CancellationTokenSource();
    return new Promise<R>((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error, value?: R): void => {
        if (settled) return;
        settled = true;
        this.pending.delete(onDeath);
        signal?.removeEventListener("abort", onAbort);
        if (err) reject(err);
        else resolve(value as R);
      };
      const onDeath = (e: Error) => settle(e);
      const onAbort = () => {
        cts.cancel(); // the library sends $/cancelRequest
        settle(new Error(`${method} was cancelled`));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      this.pending.add(onDeath);
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        conn.sendRequest<R>(method, params, cts.token).then(
          (v) => settle(undefined, v),
          (e: unknown) => settle(e instanceof Error ? e : new Error(errMsg(e))),
        );
      } catch (e) {
        settle(new Error(errMsg(e)));
      }
    });
  }

  notify(method: string, params: any): void {
    const conn = this.conn;
    if (this.state !== "running" || !conn) return;
    try {
      conn.sendNotification(method, params);
    } catch (e) {
      this.log?.(`notify ${method} failed: ${errMsg(e)}`);
    }
  }

  onNotification(method: string, handler: (params: any, method: string) => void): Disposer {
    let set = this.notifListeners.get(method);
    if (!set) {
      set = new Set();
      this.notifListeners.set(method, set);
    }
    const entry = (params: any, m: string) => handler(params, m);
    const listeners = set;
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  }

  onRequest(method: string, handler: ServerRequestHandler): Disposer {
    this.requestHandlers.set(method, handler);
    return () => {
      if (this.requestHandlers.get(method) === handler) this.requestHandlers.delete(method);
    };
  }

  onState(handler: (e: ServerStateEvent) => void): Disposer {
    this.stateListeners.add(handler);
    return () => {
      this.stateListeners.delete(handler);
    };
  }

  stderrTail(n = 40): string[] {
    if (n <= 0) return [];
    return this.stderrLines.slice(-n);
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  /** Spawns a new process and performs the handshake. `auto` = an automatic restart after a crash. */
  private launch(auto: boolean): Promise<void> {
    const gen = ++this.gen;
    this.setState("starting");
    const p = new Promise<void>((resolve, reject) => {
      this.handshake = { gen, auto, resolve: () => resolve(), reject };
      this.spawnAndInit(gen);
    });
    p.catch(() => undefined); // callers that ignore the promise (automatic restarts) must not trigger unhandled rejections
    this.handshakePromise = p;
    return p;
  }

  private spawnAndInit(gen: number): void {
    const { command, args, cwd, env } = this.spec;
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch (e) {
      this.failHandshake(gen, `Could not start ${command}: ${errMsg(e)}`);
      return;
    }
    this.child = child;
    this.pid = child.pid;
    this.startedAt = Date.now();
    this.stderrLines.length = 0;
    child.stdin?.on("error", () => undefined);
    child.stdout?.on("error", () => undefined);
    child.stderr?.on("error", () => undefined);
    this.readStderr(child);
    child.on("error", (err) => {
      if (child !== this.child) return;
      if (child.pid === undefined) this.failHandshake(gen, `Could not start ${command}: ${err.message}`);
      else this.log?.(`lean server: ${err.message}`);
    });
    child.once("exit", (code, signal) => this.afterStderrDrained(child, () => this.onExit(child, code, signal)));

    const conn = rpc.createMessageConnection(new rpc.StreamMessageReader(child.stdout!), new rpc.StreamMessageWriter(child.stdin!));
    this.conn = conn;
    conn.onNotification((method: string, params: any) => this.dispatch(method, params));
    conn.onRequest((method: string, params: any) => this.serveRequest(method, params));
    conn.listen();

    const h = this.handshake;
    if (h && h.gen === gen) {
      h.timer = this.timers.setTimeout(
        () => this.failHandshake(gen, `Lean server initialize timed out after ${this.initTimeoutMs} ms`),
        this.initTimeoutMs,
      );
    }
    conn.sendRequest<InitializeResult>("initialize", this.initParams()).then(
      (result) => {
        const cur = this.handshake;
        if (!cur || cur.gen !== gen) return;
        this.clearTimer(cur);
        this.handshake = undefined;
        this.initializeResult = result;
        try {
          conn.sendNotification("initialized", {});
        } catch {
          /* ignore */
        }
        this.setState("running");
        cur.resolve();
      },
      (e: unknown) =>
        this.afterStderrDrained(child, () => {
          // if the process is gone, the exit handler reports the failure (with its exit code)
          if (this.handshake?.gen === gen && !hasExited(child)) this.failHandshake(gen, `Lean server failed to initialize: ${errMsg(e)}`);
        }),
    );
  }

  /** Handshake failed before "running": a first start rejects, an automatic restart counts as another crash. */
  private failHandshake(gen: number, msg: string): void {
    const h = this.handshake;
    if (!h || h.gen !== gen) return;
    this.handshake = undefined;
    this.clearTimer(h);
    const child = this.child;
    if (child) this.teardown(child);
    const text = this.describe(msg);
    if (h.auto) this.onCrash(text);
    else this.setState("failed", text);
    h.reject(new Error(text));
  }

  private onExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (child !== this.child) return; // an old process, or already torn down
    if (this.stopping) {
      this.teardown(child);
      return;
    }
    const head = `Lean server exited (${signal ? `signal ${signal}` : `code ${code}`})`;
    if (this.handshake) {
      this.failHandshake(this.handshake.gen, `${head} during startup`);
      return;
    }
    const stable = this.state === "running" && Date.now() - this.startedAt >= this.stableMs;
    const text = this.describe(head);
    this.teardown(child);
    if (stable) this.crashes = 0;
    this.onCrash(text);
  }

  /** Counts a crash; either gives up (failed) or schedules a restart after the backoff delay. */
  private onCrash(text: string): void {
    if (this.stopping) return;
    this.crashes++;
    if (this.crashes >= this.maxCrashes) {
      this.setState("failed", text);
      return;
    }
    this.setState("backoff", text);
    const delay = this.backoffMs[Math.min(this.crashes - 1, this.backoffMs.length - 1)] ?? 1000;
    const handle = this.timers.setTimeout(() => {
      this.backoffTimer = undefined;
      if (this.stopping || this.state !== "backoff") return;
      void this.launch(true);
    }, delay);
    this.backoffTimer = { handle };
  }

  private async doStop(): Promise<void> {
    this.stopping = true;
    this.cancelBackoff();
    const h = this.handshake;
    this.handshake = undefined;
    if (h) {
      this.clearTimer(h);
      h.reject(new Error("Lean server was stopped during startup"));
    }
    const child = this.child;
    if (child) {
      const conn = this.conn;
      const graceful = this.state === "running" && !!conn;
      this.rejectPending(new Error("Lean server was stopped"));
      if (graceful && conn && !hasExited(child)) {
        await within(Promise.resolve().then(() => conn.sendRequest("shutdown")), 1500);
        try {
          conn.sendNotification("exit");
        } catch {
          /* ignore */
        }
      }
      if (!hasExited(child)) await exitWithin(child, 1500);
      this.teardown(child); // dispose the connection and kill the whole process group
      await exitWithin(child, 1500);
    }
    this.setState("stopped");
  }

  /** Forgets the current process (if it is still the current one), rejects pending requests, kills its group. */
  private teardown(child: ChildProcess): void {
    if (child !== this.child) return;
    const conn = this.conn;
    this.child = undefined;
    this.conn = undefined;
    this.pid = undefined;
    try {
      conn?.dispose();
    } catch {
      /* ignore */
    }
    this.rejectPending(new Error("Lean server exited"));
    killTree(child);
  }

  private cancelBackoff(): void {
    if (this.backoffTimer) {
      this.timers.clearTimeout(this.backoffTimer.handle);
      this.backoffTimer = undefined;
    }
  }

  private clearTimer(h: Handshake): void {
    if (h.timer !== undefined) this.timers.clearTimeout(h.timer);
    h.timer = undefined;
  }

  private rejectPending(err: Error): void {
    for (const f of [...this.pending]) f(err);
  }

  // ---- stderr and messages ---------------------------------------------------------------------

  private readStderr(child: ChildProcess): void {
    const decoder = new StringDecoder("utf8");
    let partial = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      partial += decoder.write(chunk);
      let nl = partial.indexOf("\n");
      while (nl >= 0) {
        this.pushStderr(partial.slice(0, nl).replace(/\r$/, ""));
        partial = partial.slice(nl + 1);
        nl = partial.indexOf("\n");
      }
    });
    child.stderr?.on("end", () => {
      if (partial) this.pushStderr(partial);
      partial = "";
    });
  }

  private pushStderr(line: string): void {
    this.stderrLines.push(line);
    if (this.stderrLines.length > STDERR_KEEP) this.stderrLines.splice(0, this.stderrLines.length - STDERR_KEEP);
    this.log?.(line);
  }

  /** Runs cb once the child's stderr has been read to the end (or after a short grace period), so its last lines are reported. */
  private afterStderrDrained(child: ChildProcess, cb: () => void): void {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      cb();
    };
    const err = child.stderr;
    if (!err || err.readableEnded || err.destroyed) {
      run();
      return;
    }
    err.once("end", run);
    err.once("close", run);
    setTimeout(run, 100);
  }

  private describe(head: string): string {
    const tail = this.stderrTail(10).join("\n").trim();
    return tail ? `${head}: ${tail}` : head;
  }

  private dispatch(method: string, params: any): void {
    const handlers = [...(this.notifListeners.get("*") ?? [])];
    if (method !== "*") handlers.push(...(this.notifListeners.get(method) ?? []));
    for (const h of handlers) {
      try {
        const r: unknown = h(params, method);
        if (r instanceof Promise) r.catch(() => undefined);
      } catch {
        /* a handler must never break the read loop */
      }
    }
  }

  private async serveRequest(method: string, params: any): Promise<unknown> {
    const h = this.requestHandlers.get(method);
    if (!h) return null;
    const result = await h(params);
    return result === undefined ? null : result;
  }

  private initParams(): Record<string, unknown> {
    const root = path.resolve(this.rootPath);
    const uri = pathToFileURL(root).toString();
    return {
      processId: process.pid,
      clientInfo: { name: "LeanPane", version: "0.1.0" },
      rootUri: uri,
      workspaceFolders: [{ uri, name: path.basename(root) }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          publishDiagnostics: { relatedInformation: true },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          hover: { contentFormat: ["markdown", "plaintext"] },
          completion: { completionItem: { snippetSupport: false } },
          definition: {},
          semanticTokens: { requests: { full: true, range: true }, tokenTypes: [], tokenModifiers: [], formats: ["relative"] },
        },
        window: { workDoneProgress: true, showDocument: { support: true } },
        workspace: { semanticTokens: { refreshSupport: true }, applyEdit: true, workspaceFolders: true },
        experimental: {},
      },
      initializationOptions: { hasWidgets: true, editDelay: 50, ...this.initOptions },
    };
  }

  private setState(state: ServerState, error?: string): void {
    this.state = state;
    const e: ServerStateEvent = { state, crashes: this.crashes };
    if (error !== undefined && (state === "backoff" || state === "failed")) e.error = error;
    for (const l of [...this.stateListeners]) {
      try {
        l(e);
      } catch {
        /* listener errors are swallowed */
      }
    }
  }
}
