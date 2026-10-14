import { describe, expect, it } from "vitest";
import { highlightTree } from "@lezer/highlight";
import { leanLanguage, leanHighlight } from "../../src/editor/leanLanguage";

function classes(src: string): Array<[string, string]> {
  const tree = leanLanguage.parser.parse(src);
  const out: Array<[string, string]> = [];
  highlightTree(tree, leanHighlight, (from, to, cls) => out.push([src.slice(from, to), cls.replace(/lp-tok-/g, "")]));
  return out;
}
const cls = (r: Array<[string, string]>, text: string) => r.find(([t]) => t === text)?.[1];
const clsAll = (r: Array<[string, string]>, text: string) => r.filter(([t]) => t === text).map(([, c]) => c);

describe("lean highlighting classes", () => {
  it("declaration keywords and binders", () => {
    const r = classes("theorem foo (n : Nat) : n + 0 = n := by\n  simp\n");
    expect(cls(r, "theorem")).toBe("keyword");
    expect(cls(r, "by")).toBe("keyword");
    expect(cls(r, "Nat")).toBe("type");
    expect(cls(r, "simp")).toBe("tactic");
  });
  it("more keywords", () => {
    const r = classes("namespace A\nopen Nat in\ndef f := fun x => if x then 1 else 2\nstructure S where\n  x : Nat\nend A\n");
    for (const k of ["namespace", "open", "def", "fun", "if", "then", "else", "structure", "where", "end", "in"]) expect(cls(r, k), k).toBe("keyword");
  });
  it("line comments, nested block comments (also across lines), doc comments", () => {
    const r = classes("-- note\n/- a /- nested -/ still -/\n/-- doc -/\ntheorem t : True := trivial\n/-! module doc -/\n");
    expect(r.find(([t]) => t.includes("note"))![1]).toBe("comment");
    expect(r.find(([t]) => t.includes("nested"))![1]).toBe("comment");
    expect(r.find(([t]) => t.includes("still"))![1]).toBe("comment");
    expect(r.find(([t]) => t.includes("doc -/") && t.startsWith("/--"))![1]).toBe("doc");
    expect(r.find(([t]) => t.includes("module doc"))![1]).toBe("doc");
    expect(cls(r, "theorem")).toBe("keyword"); // highlighting resumes after the comment
  });
  it("a block comment that spans lines keeps its state", () => {
    const r = classes("/- line one\n   theorem not_a_keyword\n-/\ndef x := 1\n");
    expect(clsAll(r, "theorem").length).toBe(0);
    expect(cls(r, "def")).toBe("keyword");
  });
  it("strings with escapes, chars, numbers", () => {
    const r = classes('def s := "a \\"q\\" b"\ndef c := \'x\'\ndef n := 0x1F + 3.14 + 42\n');
    expect(r.find(([t]) => t.startsWith('"a'))![1]).toBe("string");
    expect(cls(r, "'x'")).toBe("string");
    expect(cls(r, "42")).toBe("number");
    expect(cls(r, "0x1F")).toBe("number");
    expect(cls(r, "3.14")).toBe("number");
  });
  it("sorry and admit stand out", () => {
    const r = classes("theorem t : False := by\n  sorry\n");
    expect(cls(r, "sorry")).toBe("sorry");
  });
  it("attributes", () => {
    const r = classes("@[simp] theorem t : True := trivial\n");
    expect(r.find(([t]) => t.includes("simp"))![1]).toBe("attribute");
  });
  it("capitalised names are types; lowercase identifiers are left unstyled; dotted names are one token", () => {
    const r = classes("example (xs : List Nat) : xs.length = xs.length := rfl\n");
    expect(cls(r, "List")).toBe("type");
    expect(cls(r, "xs")).toBeUndefined();
    expect(cls(r, "rfl")).toBe("tactic");
  });
  it("unicode identifiers/operators do not break the tokenizer", () => {
    const r = classes("theorem t (α : Type) (x₁ x₂ : α) : x₁ = x₂ → ∀ y, y = x₁ := fun h _ => h ▸ rfl\n");
    expect(cls(r, "theorem")).toBe("keyword");
    expect(cls(r, "Type")).toBe("type");
    expect(cls(r, "fun")).toBe("keyword");
  });
  it("is robust: random/garbage input never throws and every token terminates", () => {
    const junk = "«» \u0000 \"unterminated\n/- unterminated block\n'\n@[\n⟨⟩\n";
    expect(() => classes(junk)).not.toThrow();
  });
  it("large files tokenize quickly", () => {
    const big = "theorem t (n : Nat) : n = n := by\n  rfl\n".repeat(3000);
    const t0 = Date.now();
    classes(big);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
