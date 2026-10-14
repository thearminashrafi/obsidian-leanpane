/**
 * Cross-module interfaces for LeanPane core. `src/core/*` must never import "obsidian".
 * Workers implement against these; do not change a signature without updating docs/tasks/*.md and the tests.
 */
import type {
  Diagnostic,
  DocumentSymbol,
  InitializeResult,
  Position,
  Range,
  TextDocumentContentChangeEvent,
} from "vscode-languageserver-protocol";
import type { DeclState, DeclStatus, DeclSummary, LeanProjectInfo } from "./integration/api-types";

export type { Diagnostic, DocumentSymbol, InitializeResult, Position, Range, TextDocumentContentChangeEvent };
export type { DeclState, DeclStatus, DeclSummary, LeanProjectInfo };

export type Disposer = () => void;
export type Logger = (message: string) => void;

// ---------------------------------------------------------------------------------------------------------------
// Settings (persisted in data.json)
// ---------------------------------------------------------------------------------------------------------------
export type LayoutMode = "split" | "editor" | "goals";
export interface LeanPaneSettings {
  /** Directory containing elan/lake/lean shims. "" = auto-detect (settings -> ~/.elan/bin -> PATH). */
  elanBinDir: string;
  /** Shut a project's server down after this many minutes without an open file. 0 = never. */
  idleShutdownMinutes: number;
  /** Absolute project roots the user trusted ("Trust this Lean project?"). */
  trustedProjects: string[];
  layout: LayoutMode;
  /** Fraction (0..1) of the width given to the editor in split layout. */
  splitRatio: number;
  goalView: "interactive" | "plain";
  messagesOpen: boolean;
  debounceMs: number;
  unicodeInput: boolean;
  unicodeLeader: string;
  unicodeEager: boolean;
  showHover: boolean;
}
export const DEFAULT_SETTINGS: LeanPaneSettings = {
  elanBinDir: "",
  idleShutdownMinutes: 10,
  trustedProjects: [],
  layout: "split",
  splitRatio: 0.55,
  goalView: "interactive",
  messagesOpen: false,
  debounceMs: 300,
  unicodeInput: true,
  unicodeLeader: "\\",
  unicodeEager: true,
  showHover: true,
};

// ---------------------------------------------------------------------------------------------------------------
// Process helpers (src/core/elan.ts)
// ---------------------------------------------------------------------------------------------------------------
export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}
/** Run a program to completion. Rejects only when the program cannot be started (ENOENT); non-zero exit is a result. */
export type ExecFn = (file: string, args: string[], opts?: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number }) => Promise<ExecResult>;
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

// ---------------------------------------------------------------------------------------------------------------
// Lean projects (src/core/projects.ts)
// ---------------------------------------------------------------------------------------------------------------
export interface ProjectDescriptor {
  /** Absolute project root (folder containing the lakefile). */
  root: string;
  lakefile: "lakefile.toml" | "lakefile.lean";
  /** Contents of `lean-toolchain`, trimmed ("leanprover/lean4:v4.25.1"), or null if the file is missing. */
  toolchain: string | null;
  usesMathlib: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Lean server (src/core/server.ts)
// ---------------------------------------------------------------------------------------------------------------
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

export type NotificationHandler = (params: any) => void;
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
export type ServerFactory = (spec: LeanServerSpec) => ILeanServer;

// ---------------------------------------------------------------------------------------------------------------
// Document sync (src/core/documents.ts)
// ---------------------------------------------------------------------------------------------------------------
export interface SyncTransport {
  notify(method: string, params: any): void;
}
export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

// ---------------------------------------------------------------------------------------------------------------
// Live declaration status (src/core/liveStatus.ts)
// ---------------------------------------------------------------------------------------------------------------
export type LiveDeclState = "error" | "stated" | "proved";
export interface LiveDecl {
  /** Fully qualified name including enclosing namespaces: "StatusProj.proved_add_zero". */
  name: string;
  /** Name as written in the document symbol. */
  shortName: string;
  /** LSP SymbolKind number from documentSymbol (e.g. 12 function, 14 constant, 5 class, 23 struct …). */
  symbolKind: number;
  range: Range;
  selectionRange: Range;
  state: LiveDeclState;
  /** First error message inside the declaration, when state === "error". */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Plain goals (src/core/goals.ts)
// ---------------------------------------------------------------------------------------------------------------
export interface GoalHyp {
  /** Names that share this type: `a b : Nat` -> ["a","b"]. */
  names: string[];
  type: string;
  /** For let-bound hypotheses `x : Nat := 5` the value text, else undefined. */
  value?: string;
}
export interface PlainGoal {
  /** `case zero` -> "zero". */
  caseName?: string;
  hyps: GoalHyp[];
  /** Text after `⊢ ` (may span lines). */
  target: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Declaration status engine, whole-project part (src/core/statusQuery.ts)
// ---------------------------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------------------------
// New project / file templates (src/core/templates.ts)
// ---------------------------------------------------------------------------------------------------------------
export interface TemplateFile {
  /** Path relative to the project root, with "/" separators. */
  path: string;
  content: string;
}
