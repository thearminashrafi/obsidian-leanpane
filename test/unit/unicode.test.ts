import { describe, expect, it } from "vitest";
import { UnicodeEngine } from "../../src/core/unicode";

/** Simulates typing `keys` into an empty document at the end, applying the engine's edits like the editor would. */
function typeKeys(engine: UnicodeEngine, keys: string, start = ""): { text: string; caretFromEnd: number } {
  let text = start;
  let caretFromEnd = 0; // only the last $CURSOR edit matters for the tests that use it
  for (const ch of keys) {
    const before = text;
    const r = engine.onType(before, ch);
    if (r.edit) {
      text = before.slice(0, r.edit.from) + r.edit.insert + before.slice(r.edit.to);
      caretFromEnd = r.edit.insert.length - r.edit.caret;
    }
    if (!r.consume) text += ch;
  }
  return { text, caretFromEnd };
}
function press(engine: UnicodeEngine, text: string): string {
  const e = engine.commit(text);
  return e ? text.slice(0, e.from) + e.insert + text.slice(e.to) : text;
}

describe("findActive", () => {
  const e = new UnicodeEngine();
  it("finds the abbreviation being typed at the end of the text", () => {
    expect(e.findActive("x \\to")).toEqual({ start: 2, abbr: "to" });
    expect(e.findActive("\\al")).toEqual({ start: 0, abbr: "al" });
    expect(e.findActive("a\\")).toEqual({ start: 1, abbr: "" });
  });
  it("is null once whitespace follows, or when there is no leader", () => {
    expect(e.findActive("x \\to ")).toBeNull();
    expect(e.findActive("plain text")).toBeNull();
    expect(e.findActive("")).toBeNull();
  });
  it("is null when the token cannot be the start of any abbreviation", () => {
    expect(e.findActive("\\qqqzzz")).toBeNull();
  });
  it("uses the LAST leader", () => {
    expect(e.findActive("\\a\\b")).toEqual({ start: 2, abbr: "b" });
  });
  it("a custom leader works", () => {
    const e2 = new UnicodeEngine({ leader: "`" });
    expect(e2.findActive("x `to")).toEqual({ start: 2, abbr: "to" });
    expect(e2.findActive("x \\to")).toBeNull();
  });
});

describe("typing", () => {
  const e = new UnicodeEngine();
  it("`\\to` + space => `→ ` (space is not part of the abbreviation, so the abbreviation is committed first)", () => {
    expect(typeKeys(e, "\\to ").text).toBe("→ ");
  });
  it("eager replacement: a unique, complete abbreviation is replaced as soon as it is complete", () => {
    expect(typeKeys(e, "\\alpha").text).toBe("α");
    expect(typeKeys(e, "x = \\forall").text).toBe("x = ∀");
  });
  it("eager can be turned off: the abbreviation stays until committed", () => {
    const lazy = new UnicodeEngine({ eager: false });
    expect(typeKeys(lazy, "\\alpha").text).toBe("\\alpha");
    expect(typeKeys(lazy, "\\alpha ").text).toBe("α ");
  });
  it("an ambiguous abbreviation waits; a character that cannot extend it commits the best match", () => {
    expect(typeKeys(e, "\\le").text).toBe("\\le"); // many abbreviations start with 'le'
    expect(typeKeys(e, "\\le ").text).toBe("≤ ");
    expect(typeKeys(e, "\\tot").text).toBe("→t"); // `to` matched, `t` is plain text
    expect(typeKeys(e, "\\to)").text).toBe("→)");
  });
  it("prefix replacement: trailing characters are kept (`\\alp7` => `α7`)", () => {
    expect(typeKeys(e, "\\alp7").text).toBe("α7");
  });
  it("$CURSOR: bracket abbreviations place the caret between the brackets", () => {
    const r = typeKeys(e, "\\<>");
    expect(r.text).toBe("⟨⟩");
    expect(r.caretFromEnd).toBe(1);
  });
  it("`\\\\` produces a single backslash", () => {
    expect(typeKeys(e, "a \\\\").text).toBe("a \\");
  });
  it("text without a leader is never touched", () => {
    expect(typeKeys(e, "theorem foo : a -> b").text).toBe("theorem foo : a -> b");
  });
  it("onType never rewrites anything outside the active abbreviation", () => {
    const r = e.onType("keep \\to", " ");
    expect(r.edit).toMatchObject({ from: 5, to: 8, insert: "→", caret: 1 });
    expect(r.consume).toBe(false);
  });
  it("multi-character input (paste) commits the active abbreviation and is not consumed", () => {
    const r = e.onType("\\to", "abc");
    expect(r.edit?.insert).toBe("→");
    expect(r.consume).toBe(false);
  });
});

describe("commit (Tab)", () => {
  const e = new UnicodeEngine();
  it("replaces the active abbreviation with the best match", () => {
    expect(press(e, "x \\alp")).toBe("x α");
    expect(press(e, "\\le")).toBe("≤");
    expect(press(e, "\\a")).toBe("α");
  });
  it("returns null when nothing is active or nothing matches", () => {
    expect(e.commit("no abbreviation")).toBeNull();
    expect(e.commit("\\qqqzzz")).toBeNull();
    expect(e.commit("\\")).toBeNull();
  });
  it("reports the caret for $CURSOR templates", () => {
    expect(e.commit("\\{}")).toMatchObject({ insert: "{}", caret: 1 });
  });
});

describe("lookup helpers", () => {
  const e = new UnicodeEngine();
  it("suggestions: shortest abbreviations first, limited", () => {
    const s = e.suggestions("to", 5);
    expect(s.length).toBe(5);
    expect(s[0]).toEqual({ abbr: "to", symbol: "→" });
    expect(s.every((x) => x.abbr.startsWith("to"))).toBe(true);
    expect(e.suggestions("qqqzzz")).toEqual([]);
  });
  it("replacementFor / abbreviationsFor", () => {
    expect(e.replacementFor("alpha")).toBe("α");
    expect(e.replacementFor("zzzz")).toBeUndefined();
    expect(e.abbreviationsFor("→")).toEqual(expect.arrayContaining(["to", "r", "->"]));
  });
  it("custom translations extend/override the table", () => {
    const c = new UnicodeEngine({ custom: { zzq: "Ж" } });
    expect(typeKeys(c, "\\zzq").text).toBe("Ж");
  });
});
