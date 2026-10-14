/**
 * Host side of the interactive infoview (milestone L3). See docs/INFOVIEW_NOTES.md.
 * The workspace view uses ONLY the public surface below (InfoviewEditorActions, InfoviewHostOptions, InfoviewHost).
 *
 * Call order for the view: construct -> `mount()` (await it; on false the view falls back to plain goals) ->
 * `serverRestarted(initializeResult)` once the server is running (and after each restart) -> `setCursor(uri, pos)`
 * on every selection / file change -> `sentClientNotification(...)` for every didOpen/didChange/didClose/didSave the
 * view sends. Any order works (state is replayed), but construct the host BEFORE the file is opened on the server so
 * that the diagnostics / fileProgress caches fill (or call `seedServerNotification` for already-known ones).
 */
import type { EditorApi, InfoviewApi, InfoviewConfig, ServerStoppedReason } from "@leanprover/infoview-api";
import type { InitializeResult, Position, Range } from "vscode-languageserver-protocol";
import type { Disposer, ILeanServer, Logger } from "../types";
import { infoviewAssets } from "./assets";
import type { FromFrame, InfoviewAssetsPayload, ToFrame } from "./protocol";
import { RefCounts } from "./refcount";
import { EditorRpcApi, Rpc } from "./rpc";
import { buildTheme, makeDomResolver } from "./theme";

export interface InfoviewEditorActions {
  /** Insert text in the editor of `uri` ("here" = at `pos` or the cursor; "above" = on a new line above the cursor line). */
  insertText(uri: string, text: string, kind: "above" | "here", pos?: Position): Promise<void>;
  /** Apply an LSP WorkspaceEdit (only edits to files open in LeanPane need to work). */
  applyEdit(edit: unknown): Promise<void>;
  /** Open `uri` (a file:// URI) in LeanPane and select `selection`. */
  showDocument(uri: string, selection?: Range): Promise<void>;
  /** Re-elaborate the file (close + reopen it on the server). */
  restartFile(uri: string): Promise<void>;
  copyToClipboard(text: string): Promise<void>;
}

export interface InfoviewHostOptions {
  /** Element the iframe is appended to (the goals pane body). The host owns only what it appends. */
  container: HTMLElement;
  /** Current Lean server for the file shown (looked up on every call; null while none is running). */
  getServer(): ILeanServer | null;
  editor: InfoviewEditorActions;
  /** Called once if the iframe fails to load (no ready message within ~8 s, or an error); the view then shows plain goals. */
  onFailed(reason: string): void;
  log?: Logger;
}

/** Server notifications we always cache (for replay when the infoview subscribes), whether subscribed or not. */
const CACHED_METHODS = ["textDocument/publishDiagnostics", "$/lean/fileProgress"] as const;
const READY_TIMEOUT_MS = 8000;
const KEEPALIVE_MS = 10000;

interface RpcSessionEntry {
  uri: string;
  server: ILeanServer;
}

export class InfoviewHost {
  private readonly opts: InfoviewHostOptions;
  /** The window whose "message" events we listen to: the container's CURRENT window (a leaf can move to a popout). */
  private listenWin: Window | undefined;
  private loads = 0;
  private iframe: HTMLIFrameElement | undefined;
  private rpc: Rpc | undefined;
  private api: InfoviewApi | undefined;
  private mountPromise: Promise<boolean> | undefined;
  private resolveMount: ((ok: boolean) => void) | undefined;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private failed = false;
  private disposed = false;
  private initializedFrame = false;
  private messageListener: ((ev: MessageEvent) => void) | undefined;

  // state replayed into the iframe
  private cursor: { uri: string; position: Position } | undefined;
  private initResult: InitializeResult | undefined;
  private stopped: ServerStoppedReason | undefined;
  private config: InfoviewConfig | undefined;

  // subscriptions
  private readonly serverSubs = new RefCounts();
  private readonly clientSubs = new RefCounts();
  private subscribedServer: ILeanServer | null = null;
  private serverDisposers = new Map<string, Disposer>();
  private readonly cache = new Map<string, Map<string, unknown>>();

  // client requests / rpc sessions
  private nextRequestId = 1;
  private readonly requests = new Map<number, { promise: Promise<unknown>; ac: AbortController }>();
  private readonly sessions = new Map<string, RpcSessionEntry>();
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: InfoviewHostOptions) {
    this.opts = opts;
    this.syncServerSubscriptions();
  }

  // ------------------------------------------------------------------------------------------------------------
  // Public surface
  // ------------------------------------------------------------------------------------------------------------

  /** Create the iframe and load the infoview. Resolves true when it reported ready, false on failure (onFailed is also called). */
  mount(): Promise<boolean> {
    if (this.mountPromise) return this.mountPromise;
    this.mountPromise = new Promise<boolean>((resolve) => {
      this.resolveMount = resolve;
      if (this.disposed) return resolve(false);
      try {
        this.createFrame();
      } catch (e) {
        this.fail(`could not create the infoview frame: ${errText(e)}`);
        return;
      }
      this.readyTimer = setTimeout(() => this.fail(`the infoview did not start within ${READY_TIMEOUT_MS / 1000} s`), READY_TIMEOUT_MS);
    });
    return this.mountPromise;
  }

  /** Cursor moved / file switched: forwards `changedCursorLocation`. `initialize` happens on the first call. */
  setCursor(uri: string, pos: Position): void {
    if (this.disposed || this.failed) return;
    this.attachWindow();
    this.cursor = { uri, position: pos };
    this.syncServerSubscriptions();
    if (!this.ready || !this.api) return;
    const loc = { uri, range: { start: pos, end: pos } };
    if (!this.initializedFrame) {
      this.initializedFrame = true;
      this.call("initialize", this.api.initialize(loc));
    } else {
      this.call("changedCursorLocation", this.api.changedCursorLocation(loc));
    }
  }

  /** After every successful (re)start of the server: forwards `serverRestarted`. */
  serverRestarted(result: InitializeResult): void {
    if (this.disposed || this.failed) return;
    this.initResult = result;
    this.stopped = undefined;
    this.dropRpcSessions(); // sessions belong to the old server process
    this.syncServerSubscriptions();
    if (this.ready && this.api) {
      this.call("serverStopped", this.api.serverStopped(undefined));
      this.call("serverRestarted", this.api.serverRestarted(result as never));
    }
  }

  serverStopped(reason?: string): void {
    if (this.disposed || this.failed) return;
    this.stopped = { message: "The Lean server has stopped.", reason: reason ?? "" };
    this.dropRpcSessions();
    if (this.ready && this.api) this.call("serverStopped", this.api.serverStopped(this.stopped));
  }

  /** Every client->server notification LeanPane sends (didOpen/didChange/didClose/didSave): forwards `sentClientNotification`. */
  sentClientNotification(method: string, params: unknown): void {
    if (this.disposed || this.failed || !this.ready || !this.api) return;
    if (!this.clientSubs.has(method)) return;
    this.call("sentClientNotification", this.api.sentClientNotification(method, params));
  }

  /** Re-read Obsidian's theme variables and push them into the iframe (call on the workspace "css-change" event). */
  refreshTheme(): void {
    if (this.disposed || this.failed || !this.iframe) return;
    this.attachWindow();
    const t = this.computeTheme();
    this.post({ lp: "theme", themeCss: t.css, dark: t.dark });
  }

  /** Extra: feed a server notification the host did not see itself (e.g. diagnostics from before the host existed). */
  seedServerNotification(method: string, params: unknown): void {
    this.cacheNotification(method, params);
  }

  /** Extra: change the infoview configuration (forwards `changedInfoviewConfig`). */
  setConfig(config: InfoviewConfig): void {
    this.config = config;
    if (this.ready && this.api) this.call("changedInfoviewConfig", this.api.changedInfoviewConfig(config));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardown();
    this.resolveMount?.(false);
    this.resolveMount = undefined;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Frame lifecycle
  // ------------------------------------------------------------------------------------------------------------

  private createFrame(): void {
    const doc = this.opts.container.ownerDocument;
    const iframe = doc.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts"); // deliberately NOT allow-same-origin: opaque origin
    iframe.className = "leanpane-infoview-frame";
    iframe.title = "Lean infoview";
    iframe.style.cssText = "width:100%;height:100%;border:0;display:block;background:transparent;";
    iframe.srcdoc = frameHtml(infoviewAssets.webviewJs);
    this.messageListener = (ev: MessageEvent) => this.onWindowMessage(ev);
    this.attachWindow();
    this.iframe = iframe;
    iframe.addEventListener?.("load", () => this.onFrameLoad());
    this.opts.container.appendChild(iframe);
  }

  private currentWindow(): Window {
    return this.opts.container.ownerDocument.defaultView ?? window;
  }

  /** Listen on the container's current window; moves the listener when the leaf was dragged to another window. */
  private attachWindow(): boolean {
    const win = this.currentWindow();
    if (win === this.listenWin || !this.messageListener) return false;
    this.listenWin?.removeEventListener("message", this.messageListener);
    win.addEventListener("message", this.messageListener);
    this.listenWin = win;
    return true;
  }

  /**
   * The iframe (re)loaded: first load, or the leaf moved to another window / was re-parented, which restarts the frame.
   * Re-attach the message listener to the new window (reloading once more if the new frame's "hello" may have been
   * missed) and, if the frame was ready before, wait for it to say hello/ready again - else fall back to plain goals.
   */
  private onFrameLoad(): void {
    if (this.disposed || this.failed || !this.iframe) return;
    const reload = this.loads++ > 0;
    const moved = this.attachWindow();
    if (!reload && !moved) return;
    this.ready = false;
    this.initializedFrame = false;
    this.api = undefined;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = setTimeout(() => this.fail(`the infoview did not restart within ${READY_TIMEOUT_MS / 1000} s`), READY_TIMEOUT_MS);
    if (moved) this.iframe.srcdoc = frameHtml(infoviewAssets.webviewJs); // our listener missed this load's hello: load again
  }

  private onWindowMessage(ev: MessageEvent): void {
    const frame = this.iframe;
    if (!frame || ev.source !== frame.contentWindow) return;
    const d = ev.data as FromFrame | undefined;
    if (!d || typeof d !== "object") return;
    switch (d.lp) {
      case "hello":
        this.onHello();
        break;
      case "rpc":
        this.rpc?.messageReceived(d.m);
        break;
      case "ready":
        this.onReady();
        break;
      case "error":
        this.fail(`infoview error: ${d.message}`);
        break;
      case "log":
        this.opts.log?.(`[infoview] ${d.message}`);
        break;
    }
  }

  /** The bootstrap script (re)started inside the iframe: fresh Rpc, send assets + theme. */
  private onHello(): void {
    this.rpc?.dispose();
    this.ready = false;
    this.initializedFrame = false;
    this.api = undefined;
    const rpc = new Rpc((m) => this.post({ lp: "rpc", m }));
    rpc.register(this.createEditorApi());
    this.rpc = rpc;
    this.api = rpc.getApi<InfoviewApi>();
    const t = this.computeTheme();
    const assets: InfoviewAssetsPayload = {
      infoviewJs: infoviewAssets.infoviewJs,
      reactJs: infoviewAssets.reactJs,
      jsxRuntimeJs: infoviewAssets.jsxRuntimeJs,
      reactDomJs: infoviewAssets.reactDomJs,
      css: infoviewAssets.css,
    };
    this.post({ lp: "init", assets, themeCss: t.css, dark: t.dark });
  }

  private onReady(): void {
    if (this.ready || this.failed || this.disposed) return;
    this.ready = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
    this.resolveMount?.(true);
    this.resolveMount = undefined;
    void this.replay();
  }

  /** Bring a (re)loaded infoview up to date. */
  private async replay(): Promise<void> {
    const api = this.api;
    if (!api) return;
    try {
      if (this.cursor) {
        this.initializedFrame = true;
        await api.initialize({ uri: this.cursor.uri, range: { start: this.cursor.position, end: this.cursor.position } });
      }
      if (this.config) await api.changedInfoviewConfig(this.config);
      if (this.stopped) await api.serverStopped(this.stopped);
      else if (this.initResult) {
        await api.serverStopped(undefined);
        await api.serverRestarted(this.initResult as never);
      }
    } catch (e) {
      this.opts.log?.(`[infoview] replay failed: ${errText(e)}`);
    }
  }

  private fail(reason: string): void {
    if (this.failed || this.disposed) return;
    this.failed = true;
    this.opts.log?.(`[infoview] failed: ${reason}`);
    this.teardown();
    this.resolveMount?.(false);
    this.resolveMount = undefined;
    try {
      this.opts.onFailed(reason);
    } catch (e) {
      this.opts.log?.(`[infoview] onFailed threw: ${errText(e)}`);
    }
  }

  /** Release everything the host created (idempotent). */
  private teardown(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = undefined;
    if (this.messageListener) this.listenWin?.removeEventListener("message", this.messageListener);
    this.messageListener = undefined;
    this.listenWin = undefined;
    this.rpc?.dispose();
    this.rpc = undefined;
    this.api = undefined;
    this.ready = false;
    for (const r of this.requests.values()) r.ac.abort();
    this.requests.clear();
    this.sessions.clear();
    for (const d of this.serverDisposers.values()) d();
    this.serverDisposers.clear();
    this.subscribedServer = null;
    this.serverSubs.clear();
    this.clientSubs.clear();
    this.cache.clear();
    this.iframe?.remove();
    this.iframe = undefined;
  }

  private post(m: ToFrame): void {
    try {
      this.iframe?.contentWindow?.postMessage(m, "*");
    } catch (e) {
      this.opts.log?.(`[infoview] postMessage failed: ${errText(e)}`);
    }
  }

  private call(name: string, p: Promise<unknown>): void {
    p.catch((e) => this.opts.log?.(`[infoview] ${name} failed: ${errText(e)}`));
  }

  private computeTheme(): { css: string; dark: boolean } {
    const body = this.opts.container.ownerDocument.body;
    const resolver = makeDomResolver(body);
    try {
      const cl = body.classList;
      const hint = cl.contains("theme-dark") ? true : cl.contains("theme-light") ? false : undefined;
      const t = buildTheme(resolver.read, hint);
      return { css: t.css, dark: t.dark };
    } finally {
      resolver.dispose();
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Server notification plumbing
  // ------------------------------------------------------------------------------------------------------------

  /** (Re)attach `onNotification` listeners on the *current* server for every method we need. */
  private syncServerSubscriptions(): void {
    if (this.disposed) return;
    const server = this.opts.getServer();
    if (server !== this.subscribedServer) {
      for (const d of this.serverDisposers.values()) d();
      this.serverDisposers.clear();
      this.subscribedServer = server;
    }
    if (!server) return;
    const wanted = new Set<string>([...CACHED_METHODS, ...this.serverSubs.keys()]);
    for (const m of wanted) {
      if (this.serverDisposers.has(m)) continue;
      this.serverDisposers.set(
        m,
        server.onNotification(m, (params) => this.onServerNotification(m, params)),
      );
    }
    for (const [m, d] of [...this.serverDisposers]) {
      if (!wanted.has(m)) {
        d();
        this.serverDisposers.delete(m);
      }
    }
  }

  private cacheNotification(method: string, params: unknown): void {
    if (!(CACHED_METHODS as readonly string[]).includes(method)) return;
    const p = params as { uri?: string; textDocument?: { uri?: string } } | undefined;
    const key = p?.uri ?? p?.textDocument?.uri;
    if (!key) return;
    let m = this.cache.get(method);
    if (!m) this.cache.set(method, (m = new Map()));
    m.set(key, params);
  }

  private onServerNotification(method: string, params: unknown): void {
    if (this.disposed || this.failed) return;
    this.cacheNotification(method, params);
    if (this.ready && this.api && this.serverSubs.has(method)) {
      this.call("gotServerNotification", this.api.gotServerNotification(method, params));
    }
  }

  /** Send cached notifications for `method` (after the infoview subscribed, its handler is registered). */
  private replayCached(method: string): void {
    const m = this.cache.get(method);
    if (!m) return;
    for (const params of m.values()) {
      if (this.ready && this.api) this.call("gotServerNotification", this.api.gotServerNotification(method, params));
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // EditorApi
  // ------------------------------------------------------------------------------------------------------------

  private requireServer(): ILeanServer {
    const s = this.opts.getServer();
    if (!s) throw new Error("No Lean server is running for this file.");
    return s;
  }

  private dropRpcSessions(): void {
    this.sessions.clear();
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = undefined;
  }

  private ensureKeepAlive(): void {
    if (this.keepAliveTimer || this.sessions.size === 0) return;
    this.keepAliveTimer = setInterval(() => {
      for (const [sessionId, s] of this.sessions) s.server.notify("$/lean/rpc/keepAlive", { uri: s.uri, sessionId });
    }, KEEPALIVE_MS);
  }

  /** The serialisable EditorApi served to the iframe. Must be a plain object of arrow functions (Rpc spreads it). */
  private createEditorApi(): EditorRpcApi {
    const editor = this.opts.editor;
    const api: EditorRpcApi = {
      saveConfig: async (config: InfoviewConfig) => {
        this.config = config; // in memory only
      },
      startClientRequest: async (_uri: string, method: string, params: unknown): Promise<number> => {
        const server = this.requireServer();
        const ac = new AbortController();
        const id = this.nextRequestId++;
        const promise = server.request(method, params, ac.signal);
        promise.catch(() => undefined); // errors are reported by awaitClientRequest
        this.requests.set(id, { promise, ac });
        return id;
      },
      awaitClientRequest: async (id: number): Promise<unknown> => {
        const r = this.requests.get(id);
        if (!r) throw new Error(`Internal error: invalid client request ID '${id}'`);
        try {
          return await r.promise;
        } finally {
          this.requests.delete(id);
        }
      },
      cancelClientRequest: async (id: number): Promise<void> => {
        this.requests.get(id)?.ac.abort();
      },
      sendClientNotification: async (_uri: string, method: string, params: unknown): Promise<void> => {
        this.opts.getServer()?.notify(method, params);
      },
      subscribeServerNotifications: async (method: string): Promise<void> => {
        this.serverSubs.inc(method);
        this.syncServerSubscriptions();
        setTimeout(() => this.replayCached(method), 0);
      },
      unsubscribeServerNotifications: async (method: string): Promise<void> => {
        this.serverSubs.dec(method);
        this.syncServerSubscriptions();
      },
      subscribeClientNotifications: async (method: string): Promise<void> => {
        this.clientSubs.inc(method);
      },
      unsubscribeClientNotifications: async (method: string): Promise<void> => {
        this.clientSubs.dec(method);
      },
      copyToClipboard: (text: string) => editor.copyToClipboard(text),
      insertText: async (text, kind, pos) => {
        const uri = pos?.textDocument.uri ?? this.cursor?.uri;
        if (!uri) throw new Error("No active Lean file to insert into.");
        await editor.insertText(uri, text, kind, pos?.position);
      },
      applyEdit: (edit) => editor.applyEdit(edit),
      showDocument: (show) => editor.showDocument(show.uri, show.selection),
      restartFile: (uri: string) => editor.restartFile(uri),
      createRpcSession: async (uri: string): Promise<string> => {
        const server = this.requireServer();
        const res = await server.request<{ sessionId: string }>("$/lean/rpc/connect", { uri });
        if (this.disposed) throw new Error("Infoview disconnected while connecting to the RPC session.");
        this.sessions.set(res.sessionId, { uri, server });
        this.ensureKeepAlive();
        return res.sessionId;
      },
      closeRpcSession: async (sessionId: string): Promise<void> => {
        this.sessions.delete(sessionId);
        if (this.sessions.size === 0 && this.keepAliveTimer) {
          clearInterval(this.keepAliveTimer);
          this.keepAliveTimer = undefined;
        }
      },
    } satisfies EditorRpcApi & Partial<EditorApi>;
    return api;
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The srcdoc: a tiny shell plus the bootstrap script (escaped so it cannot terminate the inline script early). */
export function frameHtml(webviewJs: string): string {
  const safe = webviewJs.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="react_root"></div><script>${safe}</script></body></html>`;
}
