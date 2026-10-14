/** Browser side of the infoview e2e: the real InfoviewHost wired to a fake ILeanServer that bridges to Node. */
import { InfoviewHost } from "../../../src/infoview/host";
import type { ILeanServer, Disposer } from "../../../src/types";

declare global {
  interface Window {
    __leanRequest(id: number, method: string, params: unknown): Promise<{ ok: true; result: unknown } | { ok: false; message: string; code?: number }>;
    __leanCancel(id: number): void;
    __leanNotify(method: string, params: unknown): void;
    __t: unknown;
  }
}

const listeners = new Map<string, Set<(params: any, method: string) => void>>();
let nextId = 1;
const fakeServer: ILeanServer = {
  spec: undefined as never,
  state: "running",
  initializeResult: undefined,
  pid: undefined,
  start: async () => {},
  stop: async () => {},
  restart: async () => {},
  request: async (method: string, params: unknown, signal?: AbortSignal) => {
    const id = nextId++;
    signal?.addEventListener("abort", () => window.__leanCancel(id));
    const r = await window.__leanRequest(id, method, params);
    if (r.ok) return r.result as never;
    throw Object.assign(new Error(r.message), { code: r.code });
  },
  notify: (method, params) => window.__leanNotify(method, params),
  onNotification(method, handler): Disposer {
    let s = listeners.get(method);
    if (!s) listeners.set(method, (s = new Set()));
    s.add(handler);
    return () => s!.delete(handler);
  },
  onRequest: () => () => {},
  onState: () => () => {},
  stderrTail: () => [],
};

const calls: string[] = [];
const state = { failed: undefined as string | undefined, mounted: undefined as boolean | undefined };
const host = new InfoviewHost({
  container: document.getElementById("container")!,
  getServer: () => fakeServer,
  editor: {
    insertText: async (...a) => void calls.push("insertText " + JSON.stringify(a)),
    applyEdit: async (e) => void calls.push("applyEdit " + JSON.stringify(e)),
    showDocument: async (...a) => void calls.push("showDocument " + JSON.stringify(a)),
    restartFile: async (u) => void calls.push("restartFile " + u),
    copyToClipboard: async (t) => void calls.push("copy " + t),
  },
  onFailed: (r) => (state.failed = r),
  log: (m) => console.log("[host]", m),
});

window.__t = {
  host,
  calls,
  state,
  mount: async () => (state.mounted = await host.mount()),
  deliver(method: string, params: unknown) {
    for (const h of [...(listeners.get(method) ?? [])]) h(params, method);
  },
};
