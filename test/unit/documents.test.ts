import { describe, expect, it } from "vitest";
import { DocumentSync } from "../../src/core/documents";
import type { TimerApi } from "../../src/types";

function harness(debounceMs = 300, maxPendingChanges?: number) {
  const sent: Array<{ method: string; params: any }> = [];
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; id: number; cleared: boolean }> = [];
  let nextId = 1;
  const api: TimerApi = {
    setTimeout: (fn, ms) => {
      const t = { at: now + ms, fn, id: nextId++, cleared: false };
      timers.push(t);
      return t.id;
    },
    clearTimeout: (h) => {
      const t = timers.find((x) => x.id === h);
      if (t) t.cleared = true;
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => !x.cleared && x.at <= now).sort((a, b) => a.at - b.at)) {
      t.cleared = true;
      t.fn();
    }
  };
  const doc = new DocumentSync({ notify: (method, params) => sent.push({ method, params }) }, { debounceMs, timers: api, maxPendingChanges });
  return { doc, sent, advance };
}
const ch = (line: number, c0: number, c1: number, text: string) => ({ range: { start: { line, character: c0 }, end: { line, character: c1 } }, text });

describe("DocumentSync", () => {
  it("open() sends didOpen immediately with version 1 and languageId lean4", () => {
    const { doc, sent } = harness();
    expect(doc.open("file:///a.lean", "x")).toBe(1);
    expect(sent).toEqual([{ method: "textDocument/didOpen", params: { textDocument: { uri: "file:///a.lean", languageId: "lean4", version: 1, text: "x" } } }]);
    expect(doc.isOpen("file:///a.lean")).toBe(true);
    expect(doc.open("file:///a.lean", "x")).toBe(1); // idempotent
    expect(sent.length).toBe(1);
  });

  it("debounces edits: one didChange per quiet period, carrying all changes in order, version +1", () => {
    const { doc, sent, advance } = harness(300);
    doc.open("u", "abc");
    doc.edit("u", [ch(0, 3, 3, "d")], "abcd");
    advance(100);
    doc.edit("u", [ch(0, 4, 4, "e")], "abcde");
    advance(299);
    expect(sent.length).toBe(1);
    advance(1);
    expect(sent.length).toBe(2);
    expect(sent[1]).toEqual({
      method: "textDocument/didChange",
      params: { textDocument: { uri: "u", version: 2 }, contentChanges: [ch(0, 3, 3, "d"), ch(0, 4, 4, "e")] },
    });
    expect(doc.version("u")).toBe(2);
    expect(doc.text("u")).toBe("abcde");
    advance(1000);
    expect(sent.length).toBe(2);
  });

  it("flush() sends immediately and cancels the timer", () => {
    const { doc, sent, advance } = harness();
    doc.open("u", "a");
    doc.edit("u", [ch(0, 1, 1, "b")], "ab");
    doc.flush("u");
    expect(sent.length).toBe(2);
    advance(1000);
    expect(sent.length).toBe(2);
    doc.flush("u"); // nothing pending => nothing sent
    expect(sent.length).toBe(2);
  });

  it("falls back to a single full-text change when too many changes pile up", () => {
    const { doc, sent, advance } = harness(300, 3);
    doc.open("u", "");
    for (let i = 0; i < 5; i++) doc.edit("u", [ch(0, i, i, "x")], "x".repeat(i + 1));
    advance(300);
    expect(sent[1].params.contentChanges).toEqual([{ text: "xxxxx" }]);
  });

  it("close() drops pending edits and sends didClose; later calls are ignored", () => {
    const { doc, sent, advance } = harness();
    doc.open("u", "a");
    doc.edit("u", [ch(0, 1, 1, "b")], "ab");
    doc.close("u");
    advance(1000);
    expect(sent.map((s) => s.method)).toEqual(["textDocument/didOpen", "textDocument/didClose"]);
    expect(sent[1].params).toEqual({ textDocument: { uri: "u" } });
    expect(doc.isOpen("u")).toBe(false);
    doc.edit("u", [ch(0, 0, 0, "z")], "z");
    doc.flush("u");
    doc.close("u");
    expect(sent.length).toBe(2);
  });

  it("save() flushes first, then sends didSave", () => {
    const { doc, sent } = harness();
    doc.open("u", "a");
    doc.edit("u", [ch(0, 1, 1, "b")], "ab");
    doc.save("u");
    expect(sent.map((s) => s.method)).toEqual(["textDocument/didOpen", "textDocument/didChange", "textDocument/didSave"]);
    expect(sent[2].params).toEqual({ textDocument: { uri: "u" } });
  });

  it("reopenAll() re-sends didOpen with the CURRENT text and a higher version (after a server restart)", () => {
    const { doc, sent, advance } = harness();
    doc.open("u1", "a");
    doc.open("u2", "z");
    doc.edit("u1", [ch(0, 1, 1, "b")], "ab");
    advance(300);
    sent.length = 0;
    doc.edit("u1", [ch(0, 2, 2, "c")], "abc"); // pending when the server dies
    doc.reopenAll();
    const opens = sent.filter((s) => s.method === "textDocument/didOpen");
    expect(opens.length).toBe(2);
    const u1 = opens.find((o) => o.params.textDocument.uri === "u1")!;
    expect(u1.params.textDocument.text).toBe("abc");
    expect(u1.params.textDocument.version).toBeGreaterThan(2);
    advance(1000); // the pending change was folded into the reopen
    expect(sent.filter((s) => s.method === "textDocument/didChange").length).toBe(0);
  });

  it("documents are independent; edit() on an unknown uri is ignored", () => {
    const { doc, sent, advance } = harness();
    doc.open("a", "1");
    doc.open("b", "2");
    doc.edit("a", [ch(0, 1, 1, "x")], "1x");
    doc.edit("nope", [ch(0, 0, 0, "x")], "x");
    advance(300);
    const changes = sent.filter((s) => s.method === "textDocument/didChange");
    expect(changes.length).toBe(1);
    expect(changes[0].params.textDocument.uri).toBe("a");
    expect(doc.version("b")).toBe(1);
  });

  it("dispose() cancels timers without sending anything more", () => {
    const { doc, sent, advance } = harness();
    doc.open("a", "1");
    doc.edit("a", [ch(0, 1, 1, "x")], "1x");
    doc.dispose();
    advance(1000);
    expect(sent.length).toBe(1);
  });
});
