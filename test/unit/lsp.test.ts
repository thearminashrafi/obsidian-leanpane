import { describe, expect, it } from "vitest";
import {
  appendStub,
  decodeSemanticTokens,
  defaultBlueprintEnv,
  defaultBlueprintLabel,
  definitionTargets,
  docComment,
  hoverMarkdown,
  isSorryWarning,
  pathToUri,
  progressFraction,
  sameUri,
  semanticClass,
  stepDiagnostic,
  stubBlock,
  uriToPath,
} from "../../src/core/lsp";
import type { Diagnostic } from "../../src/types";

const diag = (line: number, ch: number, severity: 1 | 2 | 3 | 4 = 1, message = "m"): Diagnostic => ({
  range: { start: { line, character: ch }, end: { line, character: ch + 1 } },
  severity,
  message,
});

describe("uris", () => {
  it("round-trips paths, including spaces", () => {
    const p = "/tmp/My Vault/Proj/A.lean";
    const u = pathToUri(p);
    expect(u.startsWith("file:///")).toBe(true);
    expect(u).toContain("%20");
    expect(uriToPath(u)).toBe(p);
    expect(uriToPath("https://example.com/x")).toBeNull();
  });
  it("sameUri ignores percent-encoding differences", () => {
    expect(sameUri("file:///a/b%20c.lean", "file:///a/b c.lean")).toBe(true);
    expect(sameUri("file:///a/b.lean", "file:///a/c.lean")).toBe(false);
  });
});

describe("semantic tokens", () => {
  const legend = { tokenTypes: ["keyword", "variable", "function"], tokenModifiers: ["declaration", "readonly"] };
  it("decodes relative positions and modifiers", () => {
    // line 0 col 0 len 7 keyword; same line +8 len 3 function with declaration; line 2 col 4 len 1 variable readonly
    const data = [0, 0, 7, 0, 0, 0, 8, 3, 2, 1, 2, 4, 1, 1, 2];
    expect(decodeSemanticTokens(data, legend)).toEqual([
      { line: 0, char: 0, length: 7, type: "keyword", modifiers: [] },
      { line: 0, char: 8, length: 3, type: "function", modifiers: ["declaration"] },
      { line: 2, char: 4, length: 1, type: "variable", modifiers: ["readonly"] },
    ]);
  });
  it("drops unknown type indices and maps classes", () => {
    expect(decodeSemanticTokens([0, 0, 1, 9, 0], legend)).toEqual([]);
    expect(semanticClass("function")).toBe("lp-sem-function");
    expect(semanticClass("keyword")).toBeNull();
    expect(semanticClass("leanSorryLike")).toBe("lp-sem-sorry");
  });
});

describe("hover / definition shapes", () => {
  it("flattens the hover content variants", () => {
    expect(hoverMarkdown(null)).toBe("");
    expect(hoverMarkdown({ contents: { kind: "markdown", value: "```lean\nx\n```" } })).toBe("```lean\nx\n```");
    expect(hoverMarkdown({ contents: "plain" })).toBe("plain");
    expect(hoverMarkdown({ contents: [{ language: "lean", value: "a" }, "b"] })).toBe("```lean\na\n```\n\nb");
  });
  it("normalises Location, Location[] and LocationLink[]", () => {
    const r = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };
    const r2 = { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } };
    expect(definitionTargets(null)).toEqual([]);
    expect(definitionTargets([])).toEqual([]);
    expect(definitionTargets({ uri: "file:///a", range: r })).toEqual([{ uri: "file:///a", range: r }]);
    expect(definitionTargets([{ targetUri: "file:///b", targetRange: r2, targetSelectionRange: r }])).toEqual([{ uri: "file:///b", range: r }]);
  });
});

describe("progress and message navigation", () => {
  it("progressFraction is 1 when idle and the share above the first processing line otherwise", () => {
    expect(progressFraction([], 100)).toBe(1);
    const p = (line: number) => ({ range: { start: { line, character: 0 }, end: { line: line + 1, character: 0 } } });
    expect(progressFraction([p(25), p(60)], 100)).toBe(0.25);
    expect(progressFraction([p(0)], 100)).toBe(0);
  });
  it("stepDiagnostic goes forward/backward and wraps", () => {
    const ds = [diag(5, 0), diag(1, 0), diag(9, 3)];
    expect(stepDiagnostic([], { line: 0, character: 0 }, 1)).toBe(-1);
    expect(stepDiagnostic(ds, { line: 0, character: 0 }, 1)).toBe(1);
    expect(stepDiagnostic(ds, { line: 1, character: 0 }, 1)).toBe(0);
    expect(stepDiagnostic(ds, { line: 9, character: 3 }, 1)).toBe(1); // wraps to the first
    expect(stepDiagnostic(ds, { line: 5, character: 0 }, -1)).toBe(1);
    expect(stepDiagnostic(ds, { line: 1, character: 0 }, -1)).toBe(2); // wraps to the last
  });
  it("recognises the sorry warning", () => {
    expect(isSorryWarning(diag(0, 0, 2, "declaration uses 'sorry'"))).toBe(true);
    expect(isSorryWarning(diag(0, 0, 1, "declaration uses 'sorry'"))).toBe(false);
  });
});

describe("stubs and blueprint defaults", () => {
  it("docComment keeps one-liners on one line and cannot be closed early", () => {
    expect(docComment("")).toBe("");
    expect(docComment("A lemma.")).toBe("/-- A lemma. -/\n");
    expect(docComment("a\nb")).toBe("/--\na\nb\n-/\n");
    expect(docComment("ends -/ here")).toBe("/-- ends - / here -/\n");
  });
  it("stubBlock is a sorry theorem with the docstring", () => {
    expect(stubBlock("Demo.lem_bound", "Bound it.")).toBe("/-- Bound it. -/\ntheorem Demo.lem_bound : sorry := by\n  sorry\n");
    expect(stubBlock("t", "")).toBe("theorem t : sorry := by\n  sorry\n");
  });
  it("appendStub separates with one blank line and reports the first line of the block", () => {
    const block = stubBlock("t", "d");
    expect(appendStub("", block)).toEqual({ text: block, line: 1 });
    expect(appendStub("import X\n", block)).toEqual({ text: "import X\n\n" + block, line: 3 });
    expect(appendStub("import X", block).line).toBe(3);
    expect(appendStub("a\n\n", block)).toEqual({ text: "a\n\n" + block, line: 3 });
  });
  it("derives LaTeX labels and environments", () => {
    expect(defaultBlueprintLabel("Demo.add_zero", "theorem")).toBe("lem:add_zero");
    expect(defaultBlueprintLabel("Demo.Foo", "structure")).toBe("def:Foo");
    expect(defaultBlueprintEnv("def")).toBe("definition");
    expect(defaultBlueprintEnv("theorem")).toBe("lemma");
  });
});
