import { afterEach, describe, expect, it } from "vitest";
import { LeanServer } from "../../src/core/server";
import { pidAlive } from "../../src/core/proc";
import type { ServerStateEvent } from "../../src/types";
import { fakeSpec, sleep, waitUntil } from "../helpers/fakeServer";

const servers: LeanServer[] = [];
function make(spec = fakeSpec(), opts: Partial<ConstructorParameters<typeof LeanServer>[1]> = {}) {
  const s = new LeanServer(spec, { rootPath: spec.cwd, backoffMs: [10, 10, 10], maxCrashes: 3, ...opts });
  servers.push(s);
  return s;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

describe("LeanServer against a fake LSP server", () => {
  it("start() performs the handshake and reports states", async () => {
    const s = make();
    const events: ServerStateEvent[] = [];
    s.onState((e) => events.push(e));
    expect(s.state).toBe("stopped");
    await s.start();
    expect(s.state).toBe("running");
    expect(s.initializeResult?.serverInfo?.name).toBe("fake-lean-server");
    expect(s.pid).toBeGreaterThan(0);
    expect(events.map((e) => e.state)).toEqual(["starting", "running"]);
  });

  it("request() round-trips and notify()/onNotification work (incl. wildcard)", async () => {
    const s = make();
    await s.start();
    expect(await s.request("test/echo", { a: [1, 2] })).toEqual({ a: [1, 2] });
    const seen: string[] = [];
    const wild: string[] = [];
    s.onNotification("test/pong", (p) => seen.push(`pong${p.n}`));
    s.onNotification("*", (_p, method) => wild.push(method));
    s.notify("test/ping", {});
    s.notify("test/ping", {});
    await waitUntil(() => seen.length === 2);
    expect(seen).toEqual(["pong1", "pong2"]);
    expect(wild.filter((m) => m === "test/pong").length).toBe(2);
  });

  it("answers server->client requests with null unless a handler is registered", async () => {
    const a = make();
    const got: any[] = [];
    a.onNotification("test/gotReply", (p) => got.push(p.result));
    await a.start();
    await waitUntil(() => got.length === 1);
    expect(got[0]).toBeNull();

    const b = make();
    const got2: any[] = [];
    b.onRequest("window/workDoneProgress/create", () => 5);
    b.onNotification("test/gotReply", (p) => got2.push(p.result));
    await b.start();
    await waitUntil(() => got2.length === 1);
    expect(got2[0]).toBe(5);
  });

  it("aborting the signal sends $/cancelRequest and rejects the request", async () => {
    const s = make();
    await s.start();
    const ac = new AbortController();
    const p = s.request("test/slow", {}, ac.signal);
    setTimeout(() => ac.abort(), 50);
    await expect(p).rejects.toBeTruthy();
    // server still usable
    expect(await s.request("test/echo", 1)).toBe(1);
  });

  it("request() rejects when the server is not running", async () => {
    const s = make();
    await expect(s.request("test/echo", 1)).rejects.toThrow();
  });

  it("rejects pending requests when the process dies, and restarts it automatically", async () => {
    const s = make();
    await s.start();
    const pid1 = s.pid!;
    const states: string[] = [];
    s.onState((e) => states.push(e.state));
    await expect(s.request("test/die", {})).rejects.toBeTruthy();
    await waitUntil(() => s.state === "running" && s.pid !== pid1);
    expect(states).toEqual(["backoff", "starting", "running"]);
    expect(await s.request("test/echo", 7)).toBe(7);
  });

  it("gives up after 3 crashes: state 'failed', stderr tail kept, no more restarts", async () => {
    const s = make(fakeSpec("crash-after-init"));
    const events: ServerStateEvent[] = [];
    s.onState((e) => events.push(e));
    await s.start(); // first start succeeds (the crash comes right after initialized)
    await waitUntil(() => s.state === "failed", 15000);
    expect(events.filter((e) => e.state === "backoff").length).toBe(2);
    expect(events[events.length - 1].crashes).toBe(3);
    expect(s.stderrTail().join("\n")).toContain("fake crash");
    await sleep(100);
    expect(s.state).toBe("failed");
    // a manual restart resets the counter and tries again
    await s.restart();
    expect(["running", "backoff", "failed"]).toContain(s.state);
  });

  it("start() rejects (and state is 'failed') when the process dies before initialize; stderr is in the error", async () => {
    const s = make(fakeSpec("exit-immediately"));
    await expect(s.start()).rejects.toThrow(/fake boot failure|exited/);
    expect(s.state).toBe("failed");
    expect(s.stderrTail().join("\n")).toContain("fake boot failure");
  });

  it("start() rejects with a timeout when initialize never answers", async () => {
    const s = make(fakeSpec("hang-init"), { initTimeoutMs: 300 });
    const pidBefore = s.pid;
    await expect(s.start()).rejects.toThrow(/timed out|timeout/i);
    expect(s.state).toBe("failed");
    expect(pidBefore).toBeUndefined();
  });

  it("start() rejects with a helpful error when the command does not exist", async () => {
    const spec = fakeSpec();
    spec.command = "/definitely/not/here/lake";
    const s = make(spec);
    await expect(s.start()).rejects.toThrow(/ENOENT|not found|spawn/i);
    expect(s.state).toBe("failed");
  });

  it("stop() is graceful, idempotent and leaves no process behind", async () => {
    const s = make();
    await s.start();
    const pid = s.pid!;
    await s.stop();
    await s.stop();
    expect(s.state).toBe("stopped");
    await waitUntil(() => !pidAlive(pid), 5000);
    await expect(s.request("test/echo", 1)).rejects.toThrow();
  });

  it("stop() during backoff cancels the pending restart", async () => {
    const s = make(fakeSpec("crash-after-init"), { backoffMs: [300, 300, 300] });
    await s.start();
    await waitUntil(() => s.state === "backoff");
    await s.stop();
    await sleep(500);
    expect(s.state).toBe("stopped");
  });

  it("restart() yields a new process and clears the crash counter", async () => {
    const s = make();
    await s.start();
    const pid1 = s.pid!;
    await s.restart();
    expect(s.state).toBe("running");
    expect(s.pid).not.toBe(pid1);
    await waitUntil(() => !pidAlive(pid1), 5000);
  });

  it.skipIf(process.platform === "win32")("stop() kills the whole process tree (grandchildren)", async () => {
    const s = make(fakeSpec("ok", { FAKE_GRANDCHILD: "1" }));
    let gc = 0;
    s.onNotification("test/grandchild", (p) => (gc = p.pid));
    await s.start();
    await waitUntil(() => gc > 0);
    expect(pidAlive(gc)).toBe(true);
    await s.stop();
    await waitUntil(() => !pidAlive(gc), 6000);
  });
});
