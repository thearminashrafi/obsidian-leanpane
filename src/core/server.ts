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
