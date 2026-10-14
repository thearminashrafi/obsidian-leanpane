// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { UnicodeEngine } from "../../src/core/unicode";
import { unicodeInput } from "../../src/editor/unicodeInput";

// jsdom has no layout; CodeMirror only needs these to return empty geometry
const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
Object.assign(Range.prototype, { getClientRects: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }), getBoundingClientRect: () => rect });

function make(engine: UnicodeEngine | null, doc = "") {
  const view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [unicodeInput(() => engine)] }), parent: document.body });
  /** Type like the browser does: input handlers first, plain insertion otherwise. */
  const type = (text: string): void => {
    for (const ch of text) {
      const { from, to } = view.state.selection.main;
      const handlers = view.state.facet(EditorView.inputHandler);
      const handled = handlers.some((h) => h(view, from, to, ch, () => view.state.update({ changes: { from, to, insert: ch } })));
      if (!handled) view.dispatch(view.state.replaceSelection(ch));
    }
  };
  const tab = (): boolean => view.state.facet(keymap).some((group) => group.some((b) => b.key === "Tab" && b.run?.(view)));
  return { view, type, tab, text: () => view.state.doc.toString(), caret: () => view.state.selection.main.head };
}

describe("unicode input in a real EditorView", () => {
  it("replaces an abbreviation when a space ends it", () => {
    const t = make(new UnicodeEngine());
    t.type("\\to ");
    expect(t.text()).toBe("→ ");
    expect(t.caret()).toBe(2);
  });
  it("replaces eagerly when the abbreviation is unambiguous", () => {
    const t = make(new UnicodeEngine({ eager: true }));
    t.type("\\alpha");
    expect(t.text()).toBe("α");
  });
  it("waits for a terminator when eager replacement is off", () => {
    const t = make(new UnicodeEngine({ eager: false }));
    t.type("\\alpha");
    expect(t.text()).toBe("\\alpha");
    t.type(" ");
    expect(t.text()).toBe("α ");
  });
  it("Tab commits the pending abbreviation and does nothing otherwise", () => {
    const t = make(new UnicodeEngine({ eager: false }));
    t.type("x \\to");
    expect(t.tab()).toBe(true);
    expect(t.text()).toBe("x →");
    expect(t.tab()).toBe(false);
  });
  it("a doubled leader gives one literal backslash that does not start a new abbreviation", () => {
    const t = make(new UnicodeEngine());
    t.type("\\\\");
    expect(t.text()).toBe("\\");
    t.type("to ");
    expect(t.text()).toBe("\\to ");
  });
  it("leaves text alone when the engine is off or no abbreviation is active", () => {
    const off = make(null);
    off.type("\\to ");
    expect(off.text()).toBe("\\to ");
    const on = make(new UnicodeEngine());
    on.type("plain text, to go");
    expect(on.text()).toBe("plain text, to go");
  });
  it("works in the middle of a line", () => {
    const t = make(new UnicodeEngine(), "fun x ");
    t.type("\\lam ");
    expect(t.text()).toBe("fun x λ ");
  });
});
