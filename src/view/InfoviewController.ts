/**
 * Safe wrapper around the interactive infoview host (src/infoview/host.ts).
 *
 * Contract with the rest of LeanPane: the workbench only ever talks to this class. Every call into InfoviewHost is
 * wrapped in try/catch; any throw, a `false` from mount(), or `onFailed` switches the goals pane back to the plain
 * goals view for good (until the next file). Notifications that arrive while the iframe is still loading are buffered
 * and replayed once it reports ready.
 */
import type { InitializeResult, Position } from "vscode-languageserver-protocol";
import { InfoviewHost, type InfoviewEditorActions, type InfoviewHostOptions } from "../infoview/host";
import type { ILeanServer, Logger } from "../types";

/** The slice of InfoviewHost this controller uses (lets tests inject a fake). */
export interface InfoviewHostLike {
  mount(): Promise<boolean>;
  setCursor(uri: string, pos: Position): void;
  serverRestarted(result: InitializeResult): void;
  serverStopped(reason?: string): void;
  sentClientNotification(method: string, params: unknown): void;
  refreshTheme(): void;
  dispose(): void;
}

export type InfoviewMode = "interactive" | "plain";

export interface InfoviewControllerOptions {
  container: HTMLElement;
  getServer(): ILeanServer | null;
  editor: InfoviewEditorActions;
  /** The goals pane should show this renderer. */
  onMode(mode: InfoviewMode, reason?: string): void;
  log?: Logger;
  createHost?: (o: InfoviewHostOptions) => InfoviewHostLike;
  /** Server notifications that already happened for the file (last diagnostics, file progress), replayed into a new host. */
  seed?: () => Array<{ method: string; params: unknown }>;
}

const MAX_BUFFERED = 300;

export class InfoviewController {
  private host: InfoviewHostLike | null = null;
  private state: "off" | "mounting" | "ready" | "failed" = "off";
  private buffered: Array<{ method: string; params: unknown }> = [];
  private cursor: { uri: string; pos: Position } | null = null;
  private runId = 0;

  constructor(private readonly o: InfoviewControllerOptions) {}

  get active(): boolean {
    return this.state === "ready";
  }
  get failed(): boolean {
    return this.state === "failed";
  }

  /** Create the iframe and load the infoview. Resolves when it is ready or has given up. */
  async start(): Promise<void> {
    if (this.state !== "off") return;
    const id = ++this.runId;
    this.state = "mounting";
    try {
      const create = this.o.createHost ?? ((opts: InfoviewHostOptions) => new InfoviewHost(opts));
      const host = create({
        container: this.o.container,
        getServer: this.o.getServer,
        editor: this.o.editor,
        onFailed: (reason) => this.fail(`infoview reported: ${reason}`),
        log: this.o.log,
      });
      this.host = host;
      const seedable = host as InfoviewHostLike & { seedServerNotification?: (m: string, p: unknown) => void };
      if (this.o.seed && typeof seedable.seedServerNotification === "function") {
        for (const n of this.o.seed()) seedable.seedServerNotification(n.method, n.params);
      }
      const ok = await Promise.resolve().then(() => host.mount());
      if (id !== this.runId) return;
      if (!ok) {
        this.fail("the infoview did not load");
        return;
      }
    } catch (e) {
      if (id === this.runId) this.fail(`could not start the infoview: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (this.state !== "mounting") return;
    this.state = "ready";
    this.o.onMode("interactive");
    // catch the iframe up with what happened while it was loading
    const server = this.o.getServer();
    const init = server?.state === "running" ? server.initializeResult : undefined;
    if (init) this.call((h) => h.serverRestarted(init));
    for (const n of this.buffered.splice(0)) this.call((h) => h.sentClientNotification(n.method, n.params));
    if (this.cursor) {
      const c = this.cursor;
      this.call((h) => h.setCursor(c.uri, c.pos));
    }
  }

  private fail(reason: string): void {
    if (this.state === "failed") return;
    this.state = "failed";
    this.o.log?.(`interactive goals unavailable (${reason}); using plain goals`);
    const host = this.host;
    this.host = null;
    try {
      host?.dispose();
    } catch {
      /* ignore */
    }
    this.buffered = [];
    this.o.onMode("plain", reason);
  }

  private call(fn: (h: InfoviewHostLike) => void): void {
    const host = this.host;
    if (!host || this.state !== "ready") return;
    try {
      fn(host);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  setCursor(uri: string, pos: Position): void {
    this.cursor = { uri, pos };
    this.call((h) => h.setCursor(uri, pos));
  }
  serverRestarted(result: InitializeResult): void {
    this.call((h) => h.serverRestarted(result));
  }
  serverStopped(reason?: string): void {
    this.call((h) => h.serverStopped(reason));
  }
  sentClientNotification(method: string, params: unknown): void {
    if (this.state === "mounting") {
      if (this.buffered.length < MAX_BUFFERED) this.buffered.push({ method, params });
      return;
    }
    this.call((h) => h.sentClientNotification(method, params));
  }
  refreshTheme(): void {
    this.call((h) => h.refreshTheme());
  }

  /** Remove the iframe. The controller can be started again afterwards. */
  dispose(): void {
    this.runId++;
    const host = this.host;
    this.host = null;
    this.state = "off";
    this.buffered = [];
    try {
      host?.dispose();
    } catch {
      /* ignore */
    }
  }
}
