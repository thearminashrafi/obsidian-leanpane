import { describe, expect, it } from "vitest";
import { LeanNotFoundError, LeanSession, type AcquiredServer, type SessionEvent } from "../../src/core/session";
import { ProjectNotTrustedError } from "../../src/core/projects";
import { pathToUri } from "../../src/core/lsp";
import type { TimerApi } from "../../src/types";
import { FakeLean } from "../helpers/fakeLean";

const FILE = "/p/Proj/A.lean";
const URI = pathToUri(FILE);

/** Manual timers so debounce/analysis delays are deterministic. */
function manualTimers() {
  let now = 0;
  const pending: Array<{ at: number; fn: () => void; id: number }> = [];
  let id = 0;
  const timers: TimerApi = {
    setTimeout: (fn, ms) => (pending.push({ at: now + ms, fn, id: ++id }), id),
    clearTimeout: (h) => {
      const i = pending.findIndex((p) => p.id === h);
      if (i >= 0) pending.splice(i, 1);
    },
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (;;) {
        const due = pending.filter((p) => p.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        pending.splice(pending.indexOf(due), 1);
        due.fn();
      }
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function make(server = new FakeLean(), over: { acquire?: () => Promise<AcquiredServer> } = {}) {
  const mt = manualTimers();
  const sent: string[] = [];
  let released = 0;
  const acquired: AcquiredServer = { key: "/p", project: { root: "/p", lakefile: "lakefile.toml", toolchain: "t", usesMathlib: false }, server, release: () => void released++ };
  const session = new LeanSession(
    { acquire: over.acquire ?? (async () => acquired), debounceMs: () => 300, onSent: (m) => sent.push(m), timers: mt.timers },
    FILE,
  );
  const events: SessionEvent[] = [];
  session.on((e) => events.push(e));
  return { session, server, mt, sent, events, released: () => released };
}

describe("LeanSession", () => {
  it("opens the document with the text current at acquisition time and reports running", async () => {
    let text = "old";
    const { session, server, events } = make();
    const p = session.open(FILE, () => text);
    text = "typed while the server was starting";
    await p;
    expect(server.sent[0]).toMatchObject({ method: "textDocument/didOpen", params: { textDocument: { uri: URI, languageId: "lean4", version: 1, text } } });
    expect(session.currentPhase).toBe("running");
    expect(events).toContain("running");
    expect(session.snapshot().leanVersion).toBe("4.25.1");
  });

  it("debounces edits into one didChange and mirrors every notification to onSent", async () => {
    const { session, server, mt, sent } = make();
    await session.open(FILE, "abc");
    session.edit([{ range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } }, text: "d" }], "abcd");
    session.edit([{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } }, text: "e" }], "abcde");
    expect(server.methods()).toEqual(["textDocument/didOpen"]);
    mt.advance(300);
    expect(server.methods()).toEqual(["textDocument/didOpen", "textDocument/didChange"]);
    expect(server.sent[1].params.contentChanges).toHaveLength(2);
    expect(server.sent[1].params.textDocument.version).toBe(2);
    session.save();
    session.close();
    expect(sent).toEqual(["textDocument/didOpen", "textDocument/didChange", "textDocument/didSave", "textDocument/didClose"]);
  });

  it("tracks diagnostics, ignores other files and stale versions, counts sorries", async () => {
    const { session, server, events } = make();
    await session.open(FILE, "x");
    const warn = { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } }, severity: 2, message: "declaration uses 'sorry'" };
    server.push("textDocument/publishDiagnostics", { uri: "file:///other.lean", diagnostics: [warn] });
    expect(session.snapshot().diagnostics).toEqual([]);
    server.push("textDocument/publishDiagnostics", { uri: URI, version: 1, diagnostics: [warn] });
    expect(session.snapshot()).toMatchObject({ sorryCount: 1, sorryLines: [2] });
    expect(events).toContain("diagnostics");
    // a newer version has been sent; an old publication must not replace the list
    session.edit([{ text: "xy" }], "xy");
    session.flush();
    server.push("textDocument/publishDiagnostics", { uri: URI, version: 1, diagnostics: [] });
    expect(session.snapshot().sorryCount).toBe(1);
    server.push("textDocument/publishDiagnostics", { uri: URI, version: 2, diagnostics: [] });
    expect(session.snapshot().sorryCount).toBe(0);
  });

  it("tracks elaboration progress and refreshes declarations when it finishes", async () => {
    const { session, server, mt, events } = make();
    server.responses["textDocument/documentSymbol"] = () => [
      { name: "thm", kind: 6, range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } }, selectionRange: { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } } },
    ];
    await session.open(FILE, "theorem thm : True := by\n  sorry\n\n\n");
    const range = { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } };
    server.push("$/lean/fileProgress", { textDocument: { uri: URI }, processing: [{ range, kind: 1 }] });
    expect(session.snapshot().progress).toBeCloseTo(1 / 5);
    server.push("textDocument/publishDiagnostics", {
      uri: URI,
      version: 1,
      diagnostics: [{ range: { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } }, severity: 2, message: "declaration uses 'sorry'" }],
    });
    mt.advance(1000);
    await tick();
    expect(server.requests.map((r) => r.method)).not.toContain("textDocument/documentSymbol"); // still processing
    server.push("$/lean/fileProgress", { textDocument: { uri: URI }, processing: [] });
    mt.advance(0);
    await tick();
    expect(events).toContain("decls");
    expect(session.snapshot().decls).toMatchObject([{ shortName: "thm", name: "thm", state: "stated" }]);
    expect(session.snapshot().progress).toBe(1);
  });

  it("reopens the document and clears state after a server restart, and shows crash phases", async () => {
    const { session, server } = make();
    await session.open(FILE, "abc");
    server.push("textDocument/publishDiagnostics", { uri: URI, version: 1, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: "e" }] });
    server.setState("backoff", "Lean crashed");
    expect(session.currentPhase).toBe("restarting");
    expect(session.snapshot().message).toBe("Lean crashed");
    server.sent.length = 0;
    server.setState("running");
    expect(session.currentPhase).toBe("running");
    expect(session.snapshot().diagnostics).toEqual([]);
    expect(server.sent[0]).toMatchObject({ method: "textDocument/didOpen", params: { textDocument: { version: 2, text: "abc" } } });
    server.setState("failed", "gave up");
    expect(session.snapshot()).toMatchObject({ phase: "failed", error: "gave up" });
  });

  it("restartFile closes and reopens; restartServer restarts the shared server", async () => {
    const { session, server } = make();
    await session.open(FILE, "abc");
    server.sent.length = 0;
    session.restartFile("abc!");
    expect(server.methods()).toEqual(["textDocument/didClose", "textDocument/didOpen"]);
    expect(server.sent[1].params.textDocument).toMatchObject({ version: 1, text: "abc!" });
    await session.restartServer();
    expect(server.restarts).toBe(1);
    expect(session.currentPhase).toBe("running");
  });

  it("request flushes pending edits first and rejects when the server is down", async () => {
    const { session, server } = make();
    await session.open(FILE, "a");
    server.responses["$/lean/plainGoal"] = () => ({ goals: ["⊢ True"] });
    session.edit([{ text: "ab" }], "ab");
    expect(await session.request("$/lean/plainGoal", {})).toEqual({ goals: ["⊢ True"] });
    expect(server.methods()).toEqual(["textDocument/didOpen", "textDocument/didChange"]);
    server.state = "failed";
    await expect(session.request("x", {})).rejects.toThrow(/not running/);
  });

  it("close gives the server back, sends didClose once and is idempotent", async () => {
    const { session, server, released } = make();
    await session.open(FILE, "a");
    session.close();
    session.close();
    expect(server.methods().filter((m) => m === "textDocument/didClose")).toHaveLength(1);
    expect(released()).toBe(1);
    expect(session.currentPhase).toBe("idle");
    server.push("textDocument/publishDiagnostics", { uri: URI, diagnostics: [{}] });
    expect(session.snapshot().diagnostics).toEqual([]);
  });

  it("turns acquisition failures into phases", async () => {
    const mk = (err: Error) => make(new FakeLean(), { acquire: async () => { throw err; } }).session;
    const a = mk(new LeanNotFoundError());
    await a.open(FILE, "");
    expect(a.currentPhase).toBe("no-lean");
    const b = mk(new ProjectNotTrustedError({ root: "/p", lakefile: "lakefile.toml", toolchain: null, usesMathlib: false }));
    await b.open(FILE, "");
    expect(b.currentPhase).toBe("untrusted");
    const c = mk(new Error("spawn failed"));
    await c.open(FILE, "");
    expect(c.snapshot()).toMatchObject({ phase: "failed", error: "spawn failed" });
  });

  it("releases a server acquired after the session was closed meanwhile", async () => {
    let finish!: (a: AcquiredServer) => void;
    const server = new FakeLean();
    const { session, released } = make(server, { acquire: () => new Promise<AcquiredServer>((r) => (finish = r)) });
    const p = session.open(FILE, "a");
    session.close();
    let rel = 0;
    finish({ key: "k", project: null, server, release: () => void rel++ });
    await p;
    expect(rel).toBe(1);
    expect(server.methods()).toEqual([]);
    void released;
  });
});
