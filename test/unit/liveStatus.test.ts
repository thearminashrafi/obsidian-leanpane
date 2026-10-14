import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { computeLiveDecls, sorryCount, sorryLines, summarize } from "../../src/core/liveStatus";
import type { Diagnostic, DocumentSymbol } from "../../src/types";

const LSP = path.resolve(__dirname, "..", "fixtures", "lsp");
const load = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(LSP, f), "utf8"));

// Real data captured from `lake serve` 4.25.1 (see test/fixtures/lsp/*.json)
describe("computeLiveDecls on captured Lean output", () => {
  it("Basic.lean: proved / stated (sorry warning) / uses-sorry-theorem (still 'proved' live) / def", () => {
    const decls = computeLiveDecls(load<DocumentSymbol[]>("basic.symbols.json"), load<Diagnostic[]>("basic.diagnostics.json"));
    const byName = Object.fromEntries(decls.map((d) => [d.name, d]));
    expect(Object.keys(byName)).toEqual(["StatusProj.proved_add_zero", "StatusProj.stated_sorry", "StatusProj.uses_sorry", "StatusProj.double"]);
    expect(byName["StatusProj.proved_add_zero"].state).toBe("proved");
    expect(byName["StatusProj.stated_sorry"].state).toBe("stated");
    expect(byName["StatusProj.uses_sorry"].state).toBe("proved"); // transitive sorry is only known from the build query
    expect(byName["StatusProj.double"].state).toBe("proved");
    expect(byName["StatusProj.stated_sorry"].shortName).toBe("stated_sorry");
    expect(byName["StatusProj.stated_sorry"].range.start.line).toBeLessThanOrEqual(14);
    expect(byName["StatusProj.stated_sorry"].selectionRange.start.line).toBe(14);
  });

  it("Broken.lean: an error diagnostic inside the declaration => error, with the first message", () => {
    const decls = computeLiveDecls(load<DocumentSymbol[]>("broken.symbols.json"), load<Diagnostic[]>("broken.diagnostics.json"));
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("StatusProj.broken_type");
    expect(decls[0].state).toBe("error");
    expect(decls[0].errorMessage).toContain("Type mismatch");
  });

  it("Goals.lean: no diagnostics => everything proved; Eval.lean: info messages and no symbols => no decls", () => {
    const g = computeLiveDecls(load<DocumentSymbol[]>("goals.symbols.json"), load<Diagnostic[]>("goals.diagnostics.json"));
    expect(g.map((d) => [d.name, d.state])).toEqual([["StatusProj.and_swap", "proved"], ["StatusProj.add_comm_three", "proved"]]);
    expect(computeLiveDecls(load<DocumentSymbol[]>("eval.symbols.json"), load<Diagnostic[]>("eval.diagnostics.json"))).toEqual([]);
  });
});

const R = (l0: number, c0: number, l1: number, c1: number) => ({ start: { line: l0, character: c0 }, end: { line: l1, character: c1 } });
const sym = (name: string, range: any, kind = 6, children?: DocumentSymbol[]): DocumentSymbol => ({ name, kind, range, selectionRange: range, children } as DocumentSymbol);
const diag = (range: any, severity: 1 | 2 | 3 | 4, message: string): Diagnostic => ({ range, severity, message });

describe("computeLiveDecls name qualification", () => {
  // Real Lean output for StatusProj/Symbols.lean: namespaces AND sections are both kind-3 container symbols
  // (a section is named just "Helpers"), so the document text is needed to tell them apart.
  const text = fs.readFileSync(path.resolve(__dirname, "..", "fixtures", "lean", "status_proj", "StatusProj", "Symbols.lean"), "utf8");
  const symbols = load<DocumentSymbol[]>("symbols.symbols.json");
  it("namespaces add a prefix, sections do not, _root_ is stripped, dotted names are kept (with the document text)", () => {
    const names = computeLiveDecls(symbols, [], text).map((d) => d.name);
    expect(names).toEqual(["A.B.thm", "A.B.Foo.bar", "A.inner", "A.Pt", "A.Color", "A.instance : Inhabited Color", "top_level", "rootDecl"]);
  });
  it("without the text every container is assumed to be a namespace", () => {
    const names = computeLiveDecls(symbols, []).map((d) => d.name);
    expect(names).toContain("A.Helpers.inner");
  });
  it("shortName is the symbol name trimmed", () => {
    const d = computeLiveDecls(symbols, [], text);
    expect(d.find((x) => x.name === "A.B.Foo.bar")!.shortName).toBe("Foo.bar");
    expect(d.find((x) => x.name === "A.instance : Inhabited Color")!.shortName).toBe("instance : Inhabited Color");
  });
  it("tolerates symbols without children and empty input", () => {
    expect(computeLiveDecls([], [])).toEqual([]);
    expect(computeLiveDecls([sym("x", R(0, 0, 1, 0))], []).length).toBe(1);
  });
});

describe("state rules", () => {
  const symbols = [sym("a", R(0, 0, 4, 0)), sym("b", R(5, 0, 9, 0)), sym("c", R(10, 0, 14, 0))];
  it("error beats stated; warnings/info other than sorry do not change the state", () => {
    const d = computeLiveDecls(symbols, [
      diag(R(1, 2, 1, 6), 2, "declaration uses 'sorry'"),
      diag(R(2, 0, 2, 3), 1, "unknown identifier 'foo'"),
      diag(R(6, 0, 6, 3), 2, "unused variable `x`"),
      diag(R(11, 0, 11, 3), 3, "42"),
    ]);
    expect(d.map((x) => x.state)).toEqual(["error", "proved", "proved"]);
  });
  it("a diagnostic outside any declaration is ignored for per-declaration state", () => {
    const d = computeLiveDecls(symbols, [diag(R(20, 0, 20, 1), 1, "parse error")]);
    expect(d.every((x) => x.state === "proved")).toBe(true);
  });
  it("matches the sorry warning in any capitalisation/wording that contains 'sorry' and severity warning", () => {
    const d = computeLiveDecls(symbols, [diag(R(6, 0, 6, 3), 2, "declaration uses `sorry`")]);
    expect(d[1].state).toBe("stated");
  });
  it("an error diagnostic starting on the declaration's last line still counts (range end is inclusive of the line)", () => {
    const d = computeLiveDecls(symbols, [diag(R(9, 0, 9, 5), 1, "oops")]);
    expect(d[1].state).toBe("error");
  });
});

describe("sorryCount / sorryLines / summarize", () => {
  const ds = [diag(R(3, 0, 3, 4), 2, "declaration uses 'sorry'"), diag(R(3, 5, 3, 9), 2, "declaration uses 'sorry'"), diag(R(8, 0, 8, 1), 2, "declaration uses 'sorry'"), diag(R(9, 0, 9, 1), 1, "err")];
  it("count = number of sorry warnings; lines = sorted unique 0-based start lines", () => {
    expect(sorryCount(ds)).toBe(3);
    expect(sorryLines(ds)).toEqual([3, 8]);
    expect(sorryCount([])).toBe(0);
  });
  it("summarize counts states", () => {
    const decls = computeLiveDecls([sym("a", R(0, 0, 1, 0)), sym("b", R(2, 0, 3, 0)), sym("c", R(4, 0, 5, 0))], [diag(R(0, 1, 0, 2), 1, "e"), diag(R(2, 1, 2, 2), 2, "declaration uses 'sorry'")]);
    expect(summarize(decls)).toEqual({ error: 1, stated: 1, proved: 1 });
  });
});
