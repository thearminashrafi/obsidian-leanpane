import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfoviewHost, frameHtml, type InfoviewHostOptions } from "../../src/infoview/host";
import { Rpc, type EditorRpcApi } from "../../src/infoview/rpc";
import type { ILeanServer } from "../../src/types";

vi.mock("../../src/infoview/theme", async (orig) => ({ ...(await orig<typeof import("../../src/infoview/theme")>()), makeDomResolver: () => ({ read: () => "", dispose() {} }) }));

/** A fake window + iframe + in-iframe Rpc peer (plays the role of webview.ts). */
function setup(over: Partial<InfoviewHostOptions> = {}) {
  const listeners = new Set<(ev: any) => void>();
  const win = {
    addEventListener: (_: string, l: any) => listeners.add(l),
    removeEventListener: (_: string, l: any) => listeners.delete(l),
  };
  const posted: any[] = [];
  const contentWindow: any = { postMessage: (m: any) => onHostPost(m) };
  const iframe: any = { attrs: {} as Record<string, string>, style: {}, contentWindow, removed: false, setAttribute(k: string, v: string) { this.attrs[k] = v; }, remove() { this.removed = true; } };
  const doc: any = { defaultView: win, body: { classList: { contains: () => true } }, createElement: () => iframe };
  const container: any = { ownerDocument: doc, appendChild: (c: any) => (container.child = c) };
  const fromFrame = (data: any, source: any = contentWindow) => listeners.forEach((l) => l({ source, data }));

  const frameApi = {
    initialize: vi.fn(async () => {}),
    changedCursorLocation: vi.fn(async () => {}),
    serverRestarted: vi.fn(async () => {}),
    serverStopped: vi.fn(async () => {}),
    gotServerNotification: vi.fn(async () => {}),
    sentClientNotification: vi.fn(async () => {}),
    changedInfoviewConfig: vi.fn(async () => {}),
  };
  const frameRpc = new Rpc((m) => fromFrame({ lp: "rpc", m }));
  const editorFromFrame = frameRpc.getApi<EditorRpcApi>();
  function onHostPost(m: any) {
    posted.push(m);
    if (m.lp === "rpc") frameRpc.messageReceived(m.m);
  }

  const handlers = new Map<string, Set<(p: any, m: string) => void>>();
  const server = {
    request: vi.fn(async (method: string, _p: any, signal?: AbortSignal) => {
      if (method === "$/lean/rpc/connect") return { sessionId: "S1" };
      if (method === "slow") return new Promise((_, rej) => signal?.addEventListener("abort", () => rej(new Error("cancelled"))));
      return { echoed: method };
    }),
    notify: vi.fn(),
    onNotification: vi.fn((m: string, h: any) => {
      let s = handlers.get(m);
      if (!s) handlers.set(m, (s = new Set()));
      s.add(h);
      return () => s!.delete(h);
    }),
  } as unknown as ILeanServer;
  const emit = (m: string, p: any) => [...(handlers.get(m) ?? [])].forEach((h) => h(p, m));

  const editor = { insertText: vi.fn(async () => {}), applyEdit: vi.fn(async () => {}), showDocument: vi.fn(async () => {}), restartFile: vi.fn(async () => {}), copyToClipboard: vi.fn(async () => {}) };
  let current: ILeanServer | null = server;
  const onFailed = vi.fn();
  const host = new InfoviewHost({ container, getServer: () => current, editor, onFailed, ...over });
  const startFrame = async () => {
    fromFrame({ lp: "hello" });
    frameRpc.register({ ...frameApi });
    fromFrame({ lp: "ready" });
    await vi.advanceTimersByTimeAsync(120);
  };
  return { host, server, emit, handlers, editor, onFailed, frameApi, editorFromFrame, fromFrame, startFrame, iframe, posted, container, listeners, setServer: (s: ILeanServer | null) => (current = s) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const loc = (line: number) => ({ uri: "file:///a.lean", range: { start: { line, character: 1 }, end: { line, character: 1 } } });

describe("InfoviewHost", () => {
  it("creates a sandboxed iframe without allow-same-origin and answers hello with init", async () => {
    const t = setup();
    const p = t.host.mount();
    expect(t.iframe.attrs.sandbox).toBe("allow-scripts");
    expect(t.container.child).toBe(t.iframe);
    t.fromFrame({ lp: "hello" });
    expect(t.posted.find((m) => m.lp === "init")).toBeTruthy();
    t.fromFrame({ lp: "ready" });
    expect(await p).toBe(true);
    expect(t.onFailed).not.toHaveBeenCalled();
  });

  it("ignores messages that do not come from the iframe window", async () => {
    const t = setup();
    void t.host.mount();
    t.fromFrame({ lp: "hello" }, { other: true });
    expect(t.posted.length).toBe(0);
  });

  it("fails once (onFailed, mount false) when no ready arrives within 8 s", async () => {
    const t = setup();
    const p = t.host.mount();
    await vi.advanceTimersByTimeAsync(8100);
    expect(await p).toBe(false);
    expect(t.onFailed).toHaveBeenCalledTimes(1);
    expect(t.iframe.removed).toBe(true);
    t.fromFrame({ lp: "error", message: "late" });
    expect(t.onFailed).toHaveBeenCalledTimes(1);
  });

  it("fails on a bootstrap error message", async () => {
    const t = setup();
    const p = t.host.mount();
    t.fromFrame({ lp: "error", message: "boom" });
    expect(await p).toBe(false);
    expect(t.onFailed).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  it("initializes on the first setCursor, then forwards changedCursorLocation", async () => {
    const t = setup();
    const p = t.host.mount();
    await t.startFrame();
    await p;
    t.host.setCursor("file:///a.lean", { line: 3, character: 1 });
    t.host.setCursor("file:///a.lean", { line: 4, character: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect(t.frameApi.initialize).toHaveBeenCalledTimes(1);
    expect(t.frameApi.initialize).toHaveBeenCalledWith(loc(3));
    expect(t.frameApi.changedCursorLocation).toHaveBeenCalledWith(loc(4));
  });

  it("replays cursor + server state set before the infoview was ready", async () => {
    const t = setup();
    t.host.setCursor("file:///a.lean", { line: 7, character: 1 });
    t.host.serverRestarted({ capabilities: {}, serverInfo: { name: "Lean 4 server", version: "4.25.1" } } as never);
    void t.host.mount();
    await t.startFrame();
    expect(t.frameApi.initialize).toHaveBeenCalledWith(loc(7));
    expect(t.frameApi.serverRestarted).toHaveBeenCalledTimes(1);
    t.host.serverStopped("crashed");
    await vi.advanceTimersByTimeAsync(10);
    expect(t.frameApi.serverStopped).toHaveBeenLastCalledWith({ message: expect.any(String), reason: "crashed" });
  });

  it("ref-counts server notification subscriptions and forwards only subscribed methods", async () => {
    const t = setup();
    void t.host.mount();
    await t.startFrame();
    await t.editorFromFrame.subscribeServerNotifications("$/foo");
    await t.editorFromFrame.subscribeServerNotifications("$/foo");
    t.emit("$/foo", { x: 1 });
    t.emit("$/bar", { x: 2 });
    await vi.advanceTimersByTimeAsync(10);
    expect(t.frameApi.gotServerNotification).toHaveBeenCalledTimes(1);
    expect(t.frameApi.gotServerNotification).toHaveBeenCalledWith("$/foo", { x: 1 });
    await t.editorFromFrame.unsubscribeServerNotifications("$/foo");
    t.emit("$/foo", { x: 3 });
    await vi.advanceTimersByTimeAsync(10);
    expect(t.frameApi.gotServerNotification).toHaveBeenCalledTimes(2);
    await t.editorFromFrame.unsubscribeServerNotifications("$/foo");
    expect(t.handlers.get("$/foo")!.size).toBe(0); // listener released at count 0
    t.emit("$/foo", { x: 4 });
    await vi.advanceTimersByTimeAsync(10);
    expect(t.frameApi.gotServerNotification).toHaveBeenCalledTimes(2);
  });

  it("replays cached diagnostics when the infoview subscribes (even if they predate the subscription)", async () => {
    const t = setup();
    void t.host.mount();
    await t.startFrame();
    const diag = { uri: "file:///a.lean", diagnostics: [] };
    t.emit("textDocument/publishDiagnostics", diag); // before any subscription
    expect(t.frameApi.gotServerNotification).not.toHaveBeenCalled();
    await t.editorFromFrame.subscribeServerNotifications("textDocument/publishDiagnostics");
    await vi.advanceTimersByTimeAsync(10);
    expect(t.frameApi.gotServerNotification).toHaveBeenCalledWith("textDocument/publishDiagnostics", diag);
  });

  it("forwards client notifications only when subscribed", async () => {
    const t = setup();
    void t.host.mount();
    await t.startFrame();
    t.host.sentClientNotification("textDocument/didChange", { a: 1 });
    await t.editorFromFrame.subscribeClientNotifications("textDocument/didChange");
    t.host.sentClientNotification("textDocument/didChange", { a: 2 });
    t.host.sentClientNotification("textDocument/didOpen", { a: 3 });
    await vi.advanceTimersByTimeAsync(10);
    expect(t.frameApi.sentClientNotification).toHaveBeenCalledTimes(1);
    expect(t.frameApi.sentClientNotification).toHaveBeenCalledWith("textDocument/didChange", { a: 2 });
  });

  it("re-attaches notification listeners when getServer() returns another server", async () => {
    const t = setup();
    void t.host.mount();
    await t.startFrame();
    await t.editorFromFrame.subscribeServerNotifications("$/foo");
    const h2 = new Set<(p: any, m: string) => void>();
    const s2 = { request: vi.fn(), notify: vi.fn(), onNotification: vi.fn((_m: string, h: any) => (h2.add(h), () => h2.delete(h))) } as unknown as ILeanServer;
    t.setServer(s2);
    t.host.setCursor("file:///b.lean", { line: 0, character: 0 });
    expect(t.handlers.get("$/foo")!.size).toBe(0);
    expect(h2.size).toBeGreaterThan(0);
  });

  it("serves requests from the current server and supports cancellation", async () => {
    const t = setup();
    void t.host.mount();
    await t.startFrame();
    const id = await t.editorFromFrame.startClientRequest("file:///a.lean", "foo", { p: 1 });
    expect(await t.editorFromFrame.awaitClientRequest(id)).toEqual({ echoed: "foo" });
    const id2 = await t.editorFromFrame.startClientRequest("file:///a.lean", "slow", {});
    const pending = t.editorFromFrame.awaitClientRequest(id2);
    pending.catch(() => {});
    await t.editorFromFrame.cancelClientRequest(id2);
    await expect(pending).rejects.toMatchObject({ message: "cancelled" });
  });

  it("rejects requests clearly when there is no server", async () => {
    const t = setup();
    void t.host.mount();
    await t.startFrame();
    t.setServer(null);
    await expect(t.editorFromFrame.startClientRequest("file:///a.lean", "foo", {})).rejects.toMatchObject({ message: expect.stringContaining("No Lean server") });
    await t.editorFromFrame.sendClientNotification("file:///a.lean", "x", {}); // silently dropped
  });

  it("opens RPC sessions, keeps them alive every 10 s, and stops when closed or disposed", async () => {
    const t = setup();
    void t.host.mount();
    await t.startFrame();
    const sid = await t.editorFromFrame.createRpcSession("file:///a.lean");
    expect(sid).toBe("S1");
    expect(t.server.request).toHaveBeenCalledWith("$/lean/rpc/connect", { uri: "file:///a.lean" });
    await vi.advanceTimersByTimeAsync(10_100);
    expect(t.server.notify).toHaveBeenCalledWith("$/lean/rpc/keepAlive", { uri: "file:///a.lean", sessionId: "S1" });
    await t.editorFromFrame.closeRpcSession(sid);
    (t.server.notify as any).mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.server.notify).not.toHaveBeenCalled();
    await t.editorFromFrame.createRpcSession("file:///a.lean");
    t.host.dispose();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.server.notify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("delegates editor actions", async () => {
    const t = setup();
    void t.host.mount();
    await t.startFrame();
    t.host.setCursor("file:///a.lean", { line: 1, character: 2 });
    await t.editorFromFrame.copyToClipboard("hi");
    await t.editorFromFrame.insertText("txt", "above");
    await t.editorFromFrame.insertText("txt", "here", { textDocument: { uri: "file:///b.lean" }, position: { line: 5, character: 0 } });
    await t.editorFromFrame.applyEdit({ changes: {} });
    await t.editorFromFrame.showDocument({ uri: "file:///b.lean", selection: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } } });
    await t.editorFromFrame.restartFile("file:///a.lean");
    expect(t.editor.copyToClipboard).toHaveBeenCalledWith("hi");
    expect(t.editor.insertText).toHaveBeenNthCalledWith(1, "file:///a.lean", "txt", "above", undefined);
    expect(t.editor.insertText).toHaveBeenNthCalledWith(2, "file:///b.lean", "txt", "here", { line: 5, character: 0 });
    expect(t.editor.applyEdit).toHaveBeenCalledWith({ changes: {} });
    expect(t.editor.showDocument).toHaveBeenCalledWith("file:///b.lean", expect.objectContaining({ start: { line: 1, character: 0 } }));
    expect(t.editor.restartFile).toHaveBeenCalledWith("file:///a.lean");
  });

  it("dispose removes the iframe and listener, resolves mount false without onFailed, and makes calls no-ops", async () => {
    const t = setup();
    const p = t.host.mount();
    t.host.dispose();
    expect(await p).toBe(false);
    expect(t.iframe.removed).toBe(true);
    expect(t.listeners.size).toBe(0);
    expect(t.onFailed).not.toHaveBeenCalled();
    t.host.setCursor("file:///a.lean", { line: 0, character: 0 });
    t.host.refreshTheme();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("frameHtml cannot be terminated by script text", () => {
    const html = frameHtml("var a='</script><b>';/* <!-- */");
    expect(html.match(/<\/script/gi)!.length).toBe(1);
    expect(html).not.toContain("<!--");
  });
});
