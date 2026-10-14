import { describe, expect, it } from "vitest";
import { ChangeSet, Text } from "@codemirror/state";
import { changesToLsp, offsetToPos, posToOffset, rangeToOffsets } from "../../src/editor/lspConvert";
import { toCMDiagnostics } from "../../src/editor/diagnostics";
import { buildSemanticDecorations } from "../../src/editor/semanticTokens";

const doc = Text.of(["theorem t : True := by", "  trivial", "", "end"]);

describe("position conversion", () => {
  it("converts offsets and positions both ways, clamping", () => {
    expect(offsetToPos(doc, 0)).toEqual({ line: 0, character: 0 });
    expect(offsetToPos(doc, 25)).toEqual({ line: 1, character: 2 });
    expect(posToOffset(doc, { line: 1, character: 2 })).toBe(25);
    expect(posToOffset(doc, { line: 1, character: 99 })).toBe(32); // line end
    expect(posToOffset(doc, { line: 99, character: 0 })).toBe(doc.length);
    expect(posToOffset(doc, { line: -1, character: 0 })).toBe(0);
    expect(rangeToOffsets(doc, { start: { line: 0, character: 8 }, end: { line: 0, character: 9 } })).toEqual({ from: 8, to: 9 });
  });
  it("counts UTF-16 units like LSP does", () => {
    const d = Text.of(["a𝔸b"]); // 𝔸 is a surrogate pair
    expect(offsetToPos(d, 3)).toEqual({ line: 0, character: 3 });
    expect(posToOffset(d, { line: 0, character: 3 })).toBe(3);
  });
});

describe("changesToLsp", () => {
  it("emits a single insertion with old-document positions", () => {
    const cs = ChangeSet.of({ from: 8, to: 9, insert: "name" }, doc.length);
    expect(changesToLsp(doc, cs)).toEqual([{ range: { start: { line: 0, character: 8 }, end: { line: 0, character: 9 } }, text: "name" }]);
  });
  it("orders several changes from last to first so sequential application is correct", () => {
    // replace "theorem" by "lemma" (0..7) and "trivial" (25+2.. ) by "simp"
    const cs = ChangeSet.of([{ from: 0, to: 7, insert: "lemma" }, { from: 25, to: 32, insert: "simp" }], doc.length);
    const events = changesToLsp(doc, cs);
    expect(events.map((e) => e.text)).toEqual(["simp", "lemma"]);
    // apply them sequentially to the text and compare with CodeMirror's result
    let text = doc.toString();
    const lines = () => text.split("\n");
    for (const e of events) {
      const r = (e as { range: import("vscode-languageserver-protocol").Range }).range;
      const ls = lines();
      const off = (p: { line: number; character: number }) => ls.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
      text = text.slice(0, off(r.start)) + e.text + text.slice(off(r.end));
    }
    expect(text).toBe(cs.apply(doc).toString());
  });
  it("handles multi-line insertions and deletions", () => {
    const cs = ChangeSet.of({ from: 22, to: 33, insert: "\n  simp\n" }, doc.length);
    const [e] = changesToLsp(doc, cs);
    expect((e as { range?: unknown }).range).toEqual({ start: { line: 0, character: 22 }, end: { line: 2, character: 0 } });
    expect(e.text).toBe("\n  simp\n");
  });
});

describe("diagnostics and semantic decorations", () => {
  it("widens empty ranges and maps severities", () => {
    const d = (line: number, c0: number, c1: number, severity: 1 | 2 | 3 | 4) => ({ range: { start: { line, character: c0 }, end: { line, character: c1 } }, severity, message: `m${severity}` });
    const out = toCMDiagnostics(doc, [d(0, 8, 9, 1), d(0, 8, 8, 2), d(0, 22, 22, 3), d(2, 0, 0, 1)]);
    expect(out.map((x) => [x.from, x.to, x.severity])).toEqual([[8, 9, "error"], [8, 9, "warning"], [21, 22, "info"]]); // empty line: nothing to underline
  });
  it("builds decorations only for styled token types inside the document", () => {
    const set = buildSemanticDecorations(doc, [
      { line: 0, char: 0, length: 7, type: "keyword", modifiers: [] },
      { line: 0, char: 8, length: 1, type: "function", modifiers: [] },
      { line: 99, char: 0, length: 1, type: "function", modifiers: [] },
      { line: 1, char: 2, length: 7, type: "type", modifiers: [] },
    ]);
    const spans: number[][] = [];
    const it = set.iter();
    while (it.value) {
      spans.push([it.from, it.to]);
      it.next();
    }
    expect(spans).toEqual([[8, 9], [25, 32]]);
  });
});
