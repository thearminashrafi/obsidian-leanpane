/**
 * One open Lean document on a (shared) language server: acquires the server, keeps the document in sync,
 * and tracks diagnostics, elaboration progress and the declarations of the file. Pure (no "obsidian").
 */
import type { Diagnostic, Disposer, DocumentSymbol, ILeanServer, InitializeResult, LiveDecl, Logger, ProjectDescriptor, TextDocumentContentChangeEvent, TimerApi } from "../types";
import { DocumentSync } from "./documents";
import { computeLiveDecls, sorryCount, sorryLines } from "./liveStatus";
import { pathToUri, progressFraction, sameUri, type ProgressRange } from "./lsp";

export type SessionPhase =
  | "idle" // nothing open
  | "preparing" // waiting for elan / the server (message in `message`)
  | "running"
  | "restarting" // crashed and coming back, or being restarted
  | "failed" // gave up after repeated crashes, or could not start
  | "untrusted" // the user declined to trust the project
  | "no-lean"; // elan / lake not found

export interface AcquiredServer {
  key: string;
  project: ProjectDescriptor | null;
  server: ILeanServer;
  release(): void;
}
export interface AcquireHooks {
  /** The server takes a while (for example elan downloads a toolchain): show this text meanwhile. */
  preparing(message: string): void;
}
export class LeanNotFoundError extends Error {
  constructor(message = "Lean (elan / lake) was not found") {
    super(message);
    this.name = "LeanNotFoundError";
  }
}

export interface SessionDeps {
  acquire(file: string, contextFile: string, hooks: AcquireHooks): Promise<AcquiredServer>;
  debounceMs(): number;
  /** Called for every notification sent to the server (didOpen/didChange/didClose/didSave): the infoview mirrors them. */
  onSent?(method: string, params: unknown): void;
  /** Maps an error from `acquire` to a phase; default: ProjectNotTrustedError-like names -> "untrusted", LeanNotFoundError -> "no-lean". */
  classifyError?(e: unknown): SessionPhase;
  timers?: TimerApi;
  log?: Logger;
  /** Delay before the declaration list is refreshed after diagnostics settle (default 400 ms). */
  analysisDelayMs?: number;
}

export type SessionEvent =
  | "phase" // phase / message changed
  | "diagnostics"
  | "progress"
  | "decls" // live declarations refreshed (the document finished elaborating)
  | "running"; // server (re)started and the document has been (re)opened

export interface SessionSnapshot {
  phase: SessionPhase;
  message: string;
  error?: string;
  diagnostics: Diagnostic[];
  processing: ProgressRange[];
  /** 0..1 */
  progress: number;
  sorryLines: number[];
  sorryCount: number;
  leanVersion?: string;
  project: ProjectDescriptor | null;
  decls: LiveDecl[];
}

const defaultTimers: TimerApi = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class LeanSession {
  readonly filePath: string;
  readonly uri: string;

  private phase: SessionPhase = "idle";
  private message = "";
  private error: string | undefined;
  private diagnostics: Diagnostic[] = [];
  private processing: ProgressRange[] = [];
  private decls: LiveDecl[] = [];
  private acquired: AcquiredServer | null = null;
  private docs: DocumentSync | null = null;
  private subs: Disposer[] = [];
  private listeners = new Set<(e: SessionEvent) => void>();
  private analysisTimer: unknown;
  private analysisAbort: AbortController | null = null;
  private analysisWanted = false;
  private generation = 0;
  private closed = false;
  private readonly timers: TimerApi;
  private readonly log: Logger;

  constructor(private readonly deps: SessionDeps, filePath: string) {
    this.filePath = filePath;
    this.uri = pathToUri(filePath);
    this.timers = deps.timers ?? defaultTimers;
    this.log = deps.log ?? (() => undefined);
  }

  // ------------------------------------------------------------------ public state
  get server(): ILeanServer | null {
    return this.acquired?.server ?? null;
  }
  get project(): ProjectDescriptor | null {
    return this.acquired?.project ?? null;
  }
  isOpen(): boolean {
    return this.docs?.isOpen(this.uri) ?? false;
  }
  get currentPhase(): SessionPhase {
    return this.phase;
  }
  snapshot(): SessionSnapshot {
    const total = this.docs?.text(this.uri)?.split("\n").length ?? 0;
    const s: SessionSnapshot = {
      phase: this.phase,
      message: this.message,
      diagnostics: this.diagnostics,
      processing: this.processing,
      progress: progressFraction(this.processing, total),
      sorryLines: sorryLines(this.diagnostics),
      sorryCount: sorryCount(this.diagnostics),
      project: this.project,
      decls: this.decls,
    };
    if (this.error !== undefined) s.error = this.error;
    const v = this.acquired?.server.initializeResult?.serverInfo?.version;
    if (v) s.leanVersion = v;
    return s;
  }
  stderrTail(n = 40): string[] {
    return this.acquired?.server.stderrTail(n) ?? [];
  }
  on(l: (e: SessionEvent) => void): Disposer {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  private emit(e: SessionEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        this.log(`session listener failed: ${errText(err)}`);
      }
    }
  }
  private setPhase(phase: SessionPhase, message = "", error?: string): void {
    if (this.phase === phase && this.message === message && this.error === error) return;
    this.phase = phase;
    this.message = message;
    this.error = error;
    this.emit("phase");
  }

  // ------------------------------------------------------------------ lifecycle
  /** Acquire the server and open the document. Never rejects: failures become a phase (see `snapshot().error`). */
  async open(contextFile: string, text: string | (() => string)): Promise<void> {
    const gen = ++this.generation;
    this.closed = false;
    this.setPhase("preparing", "Starting Lean…");
    let acquired: AcquiredServer;
    try {
      acquired = await this.deps.acquire(this.filePath, contextFile, { preparing: (m) => gen === this.generation && this.setPhase("preparing", m) });
    } catch (e) {
      if (gen !== this.generation) return;
      this.setPhase(this.classify(e), "", errText(e));
      return;
    }
    if (gen !== this.generation || this.closed) {
      acquired.release();
      return;
    }
    this.acquired = acquired;
    const server = acquired.server;
    this.docs = new DocumentSync(
      {
        notify: (method, params) => {
          this.acquired?.server.notify(method, params);
          this.deps.onSent?.(method, params);
        },
      },
      { debounceMs: this.deps.debounceMs(), timers: this.timers },
    );
    this.subs.push(
      server.onNotification("textDocument/publishDiagnostics", (p) => this.onDiagnostics(p)),
      server.onNotification("$/lean/fileProgress", (p) => this.onProgress(p)),
      server.onState((e) => this.onServerState(e.state, e.error)),
    );
    // the text is read now, not before acquiring: the user may have kept typing while the server started
    this.docs.open(this.uri, typeof text === "function" ? text() : text);
    this.setPhase("running");
    this.emit("running");
  }

  private classify(e: unknown): SessionPhase {
    if (this.deps.classifyError) return this.deps.classifyError(e);
    if (e instanceof LeanNotFoundError) return "no-lean";
    if (e instanceof Error && e.name === "ProjectNotTrustedError") return "untrusted";
    return "failed";
  }

  private onServerState(state: string, error?: string): void {
    if (this.closed) return;
    if (state === "running") {
      this.diagnostics = [];
      this.processing = [];
      this.docs?.reopenAll();
      this.setPhase("running");
      this.emit("diagnostics");
      this.emit("progress");
      this.emit("running");
    } else if (state === "failed") {
      this.setPhase("failed", "", error ?? "The Lean server keeps crashing.");
    } else if (state === "starting" || state === "backoff" || state === "stopped") {
      this.setPhase("restarting", state === "backoff" ? (error ?? "Lean crashed; restarting…") : "Restarting Lean…");
    }
  }

  private matches(uri: string): boolean {
    return uri === this.uri || sameUri(uri, this.uri);
  }

  private onDiagnostics(p: { uri: string; version?: number; diagnostics: Diagnostic[] }): void {
    if (!this.matches(p.uri) || !this.docs?.isOpen(this.uri)) return;
    const cur = this.docs.version(this.uri);
    if (typeof p.version === "number" && cur !== undefined && p.version < cur) return; // stale: a newer version was already sent
    this.diagnostics = p.diagnostics ?? [];
    this.emit("diagnostics");
    this.scheduleAnalysis();
  }

  private onProgress(p: { textDocument: { uri: string }; processing: ProgressRange[] }): void {
    if (!this.matches(p.textDocument.uri) || !this.docs?.isOpen(this.uri)) return;
    this.processing = p.processing ?? [];
    this.emit("progress");
    if (this.processing.length === 0) {
      // elaboration finished: refresh declarations right away
      this.analysisWanted = true;
      this.runAnalysisSoon(0);
    }
  }

  // ------------------------------------------------------------------ declarations
  private scheduleAnalysis(): void {
    this.analysisWanted = true;
    this.runAnalysisSoon(this.deps.analysisDelayMs ?? 400);
  }

  private runAnalysisSoon(ms: number): void {
    if (this.analysisTimer !== undefined) this.timers.clearTimeout(this.analysisTimer);
    this.analysisTimer = this.timers.setTimeout(() => {
      this.analysisTimer = undefined;
      void this.runAnalysis();
    }, ms);
  }

  private async runAnalysis(): Promise<void> {
    const docs = this.docs;
    const server = this.server;
    if (!docs || !server || server.state !== "running" || !docs.isOpen(this.uri)) return;
    if (this.processing.length > 0) return; // refreshed when progress reaches zero
    if (!this.analysisWanted) return;
    this.analysisWanted = false;
    this.analysisAbort?.abort();
    const ac = new AbortController();
    this.analysisAbort = ac;
    const version = docs.version(this.uri);
    try {
      docs.flush(this.uri);
      const syms = await server.request<DocumentSymbol[] | null>("textDocument/documentSymbol", { textDocument: { uri: this.uri } }, ac.signal);
      if (ac.signal.aborted || this.closed || docs.version(this.uri) !== version) {
        this.analysisWanted = true;
        return;
      }
      this.decls = computeLiveDecls(syms ?? [], this.diagnostics, docs.text(this.uri));
      this.emit("decls");
    } catch (e) {
      if (!ac.signal.aborted) this.log(`documentSymbol failed: ${errText(e)}`);
    }
  }

  // ------------------------------------------------------------------ document operations
  edit(changes: TextDocumentContentChangeEvent[], fullText: string): void {
    this.docs?.edit(this.uri, changes, fullText);
  }
  flush(): void {
    this.docs?.flush(this.uri);
  }
  save(): void {
    this.docs?.save(this.uri);
  }
  /** Current text as the server knows it (after the last edit call). */
  text(): string | undefined {
    return this.docs?.text(this.uri);
  }
  version(): number | undefined {
    return this.docs?.version(this.uri);
  }

  /** LSP request about this document. Pending edits are sent first. Rejects when no server is running. */
  async request<T = any>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const server = this.server;
    if (!server || server.state !== "running") throw new Error("Lean server is not running");
    this.docs?.flush(this.uri);
    return server.request<T>(method, params, signal);
  }

  /** Close and reopen the document on the server (re-elaborate from scratch). */
  restartFile(text: string): void {
    if (!this.docs) return;
    this.docs.close(this.uri);
    this.diagnostics = [];
    this.processing = [];
    this.decls = [];
    this.emit("diagnostics");
    this.emit("progress");
    this.docs.open(this.uri, text);
  }

  async restartServer(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.setPhase("restarting", "Restarting Lean…");
    try {
      await server.restart();
    } catch (e) {
      this.setPhase("failed", "", errText(e));
    }
  }

  /** didClose, give the server back. The session cannot be reused afterwards except by `open` again. */
  close(): void {
    this.closed = true;
    this.generation++;
    if (this.analysisTimer !== undefined) this.timers.clearTimeout(this.analysisTimer);
    this.analysisTimer = undefined;
    this.analysisAbort?.abort();
    for (const d of this.subs.splice(0)) d();
    if (this.docs) {
      this.docs.close(this.uri);
      this.docs.dispose();
      this.docs = null;
    }
    this.acquired?.release();
    this.acquired = null;
    this.diagnostics = [];
    this.processing = [];
    this.decls = [];
    this.phase = "idle";
    this.message = "";
    this.error = undefined;
  }

  /** The server's initialize result, for the infoview. */
  initializeResult(): InitializeResult | undefined {
    return this.acquired?.server.initializeResult;
  }
}
