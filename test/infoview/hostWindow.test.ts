import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfoviewHost } from "../../src/infoview/host";
import type { ILeanServer } from "../../src/types";

vi.mock("../../src/infoview/theme", async (orig) => ({ ...(await orig<typeof import("../../src/infoview/theme")>()), makeDomResolver: () => ({ read: () => "", dispose() {} }) }));

function fakeWindow() {
  const ls = new Set<(ev: any) => void>();
  return { ls, addEventListener: (_: string, l: any) => ls.add(l), removeEventListener: (_: string, l: any) => ls.delete(l), send: (ev: any) => [...ls].forEach((l) => l(ev)) };
}

function setup() {
  const winA = fakeWindow();
  const winB = fakeWindow();
  const posted: any[] = [];
  const contentWindow = { postMessage: (m: any) => posted.push(m) };
  const loadHandlers: Array<() => void> = [];
  const iframe: any = {
    attrs: {} as Record<string, string>,
    style: {},
    srcdoc: "",
    contentWindow,
    removed: false,
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    addEventListener: (ev: string, h: () => void) => ev === "load" && loadHandlers.push(h),
    remove() { this.removed = true; },
  };
  const doc: any = { defaultView: winA, body: { classList: { contains: () => true } }, createElement: () => iframe };
  const container: any = { ownerDocument: doc, appendChild: () => undefined };
  const onFailed = vi.fn();
  const server = { onNotification: () => () => undefined, request: async () => null, notify: () => undefined } as unknown as ILeanServer;
  const editor = { insertText: async () => {}, applyEdit: async () => {}, showDocument: async () => {}, restartFile: async () => {}, copyToClipboard: async () => {} };
  const host = new InfoviewHost({ container, getServer: () => server, editor, onFailed });
  const frameLoaded = () => loadHandlers.forEach((h) => h());
  const moveTo = (w: ReturnType<typeof fakeWindow>) => (doc.defaultView = w);
  return { host, winA, winB, iframe, contentWindow, posted, onFailed, frameLoaded, moveTo };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("InfoviewHost in popout windows", () => {
  it("listens on the container's window, re-attaches when the leaf moves, and the frame re-handshakes there", async () => {
    const t = setup();
    const p = t.host.mount();
    expect(t.winA.ls.size).toBe(1);
    t.winA.send({ source: t.contentWindow, data: { lp: "hello" } });
    t.winA.send({ source: t.contentWindow, data: { lp: "ready" } });
    expect(await p).toBe(true);

    // the leaf is dragged into a popout: the iframe reloads inside the new window's document
    t.moveTo(t.winB);
    t.frameLoaded();
    expect(t.winA.ls.size).toBe(0);
    expect(t.winB.ls.size).toBe(1);
    expect(t.iframe.srcdoc).toContain("<script>"); // reloaded once more so the new listener hears its hello
    t.posted.length = 0;
    t.winB.send({ source: t.contentWindow, data: { lp: "hello" } });
    expect(t.posted.find((m) => m.lp === "init")).toBeTruthy();
    t.winB.send({ source: t.contentWindow, data: { lp: "ready" } });
    await vi.advanceTimersByTimeAsync(9000);
    expect(t.onFailed).not.toHaveBeenCalled();
  });

  it("falls back to plain goals when a reloaded frame never says hello/ready again", async () => {
    const t = setup();
    const p = t.host.mount();
    t.winA.send({ source: t.contentWindow, data: { lp: "hello" } });
    t.winA.send({ source: t.contentWindow, data: { lp: "ready" } });
    await p;
    t.frameLoaded(); // the first load
    t.frameLoaded(); // reload (e.g. re-parented) and silence
    await vi.advanceTimersByTimeAsync(8100);
    expect(t.onFailed).toHaveBeenCalledTimes(1);
    expect(t.winA.ls.size).toBe(0);
    expect(t.iframe.removed).toBe(true);
  });

  it("dispose removes the listener from the window it moved to", () => {
    const t = setup();
    void t.host.mount();
    t.moveTo(t.winB);
    t.frameLoaded();
    t.host.dispose();
    expect(t.winA.ls.size + t.winB.ls.size).toBe(0);
  });
});
