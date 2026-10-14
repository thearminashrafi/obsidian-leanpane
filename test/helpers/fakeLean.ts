import type { Disposer, ILeanServer, InitializeResult, LeanServerSpec, ServerRequestHandler, ServerState, ServerStateEvent } from "../../src/types";

/** In-memory ILeanServer for tests: records notifications, answers requests from a table, lets the test push server events. */
export class FakeLean implements ILeanServer {
  spec: LeanServerSpec = { kind: "lake", command: "lake", args: [], cwd: "/p", env: {} };
  state: ServerState = "running";
  initializeResult: InitializeResult | undefined = { capabilities: {}, serverInfo: { name: "Lean 4 server", version: "4.25.1" } };
  pid: number | undefined = 4242;
  sent: Array<{ method: string; params: any }> = [];
  requests: Array<{ method: string; params: any }> = [];
  responses: Record<string, (params: any) => unknown> = {};
  restarts = 0;
  private notif = new Map<string, Set<(p: any, m: string) => void>>();
  private states = new Set<(e: ServerStateEvent) => void>();

  async start(): Promise<void> {
    this.state = "running";
  }
  async stop(): Promise<void> {
    this.state = "stopped";
  }
  async restart(): Promise<void> {
    this.restarts++;
    this.setState("stopped");
    this.setState("starting");
    this.setState("running");
  }
  async request<R = any>(method: string, params: any, signal?: AbortSignal): Promise<R> {
    this.requests.push({ method, params });
    if (signal?.aborted) throw new Error("cancelled");
    const f = this.responses[method];
    if (!f) return null as R;
    return f(params) as R;
  }
  notify(method: string, params: any): void {
    this.sent.push({ method, params });
  }
  onNotification(method: string, handler: (params: any, method: string) => void): Disposer {
    let s = this.notif.get(method);
    if (!s) this.notif.set(method, (s = new Set()));
    s.add(handler);
    return () => void s!.delete(handler);
  }
  onRequest(_m: string, _h: ServerRequestHandler): Disposer {
    return () => undefined;
  }
  onState(h: (e: ServerStateEvent) => void): Disposer {
    this.states.add(h);
    return () => void this.states.delete(h);
  }
  stderrTail(): string[] {
    return ["boom"];
  }
  // ---- test controls
  push(method: string, params: any): void {
    for (const h of [...(this.notif.get(method) ?? [])]) h(params, method);
  }
  setState(state: ServerState, error?: string): void {
    this.state = state;
    for (const h of [...this.states]) h({ state, crashes: 0, ...(error ? { error } : {}) });
  }
  methods(): string[] {
    return this.sent.map((s) => s.method);
  }
}
