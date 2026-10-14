// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { leanSyntax } from "../../src/editor/leanLanguage";

function render(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [leanSyntax()] }), parent });
  return { view, spans: () => [...parent.querySelectorAll("span[class*='lp-tok-']")].map((e) => [e.textContent, e.className.match(/lp-tok-\w+/)![0].slice(7)]) };
}

describe("class-based Lean syntax marks", () => {
  it("colours keywords, tactics, types, comments and sorry", () => {
    const { spans } = render("theorem foo (n : Nat) : n = n := by\n  rfl -- done\n  sorry");
    const m = new Map(spans().map(([t, c]) => [t, c]));
    expect(m.get("theorem")).toBe("keyword");
    expect(m.get("Nat")).toBe("type");
    expect(m.get("rfl")).toBe("tactic");
    expect(m.get("-- done")).toBe("comment");
    expect(m.get("sorry")).toBe("sorry");
  });
  it("carries block comments across lines and recovers after edits", () => {
    const { view, spans } = render("/- a\n theorem\n-/\ntheorem x");
    expect(spans().filter(([t, c]) => t === "theorem" && c === "keyword").length).toBe(1);
    view.dispatch({ changes: { from: 0, to: 3, insert: "" } }); // comment no longer opens
    expect(spans().filter(([t, c]) => t === "theorem" && c === "keyword").length).toBe(2);
  });
});
