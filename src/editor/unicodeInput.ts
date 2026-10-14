/** Unicode abbreviation input (`\to` + space / Tab -> →) on top of src/core/unicode.ts. */
import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { UnicodeEngine, UnicodeEdit } from "../core/unicode";

/** Position of a `\` that came out of a `\\` replacement: it is a literal backslash, not a new leader. */
const setLiteral = StateEffect.define<number>();
const literalField = StateField.define<number>({
  create: () => -1,
  update(v, tr) {
    let out = v >= 0 ? tr.changes.mapPos(v, -1) : -1;
    for (const e of tr.effects) if (e.is(setLiteral)) out = e.value;
    return out;
  },
});

function apply(view: EditorView, lineFrom: number, e: UnicodeEdit, typed: string, consume: boolean, leader: string): void {
  const from = lineFrom + e.from;
  const to = lineFrom + e.to;
  const insert = e.insert + (consume ? "" : typed);
  const caret = e.caret < e.insert.length ? from + e.caret : from + insert.length;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: caret },
    effects: e.insert === leader ? [setLiteral.of(from)] : [],
    userEvent: "input.type",
    scrollIntoView: true,
  });
}

export function unicodeInput(getEngine: () => UnicodeEngine | null): Extension {
  const activeStart = (engine: UnicodeEngine, view: EditorView, head: number): { lineFrom: number; before: string; start: number } | null => {
    const line = view.state.doc.lineAt(head);
    const before = line.text.slice(0, head - line.from);
    const a = engine.findActive(before);
    if (!a) return null;
    if (line.from + a.start === view.state.field(literalField)) return null;
    return { lineFrom: line.from, before, start: a.start };
  };

  return [
    literalField,
    EditorView.inputHandler.of((view, from, to, text) => {
      const engine = getEngine();
      if (!engine || from !== to || text.length !== 1) return false;
      const ctx = activeStart(engine, view, from);
      if (!ctx) return false;
      const r = engine.onType(ctx.before, text);
      if (!r.edit) return false;
      apply(view, ctx.lineFrom, r.edit, text, r.consume, engine.leaderChar);
      return true;
    }),
    Prec.high(
      keymap.of([
        {
          key: "Tab",
          run: (view) => {
            const engine = getEngine();
            const sel = view.state.selection.main;
            if (!engine || !sel.empty) return false;
            const ctx = activeStart(engine, view, sel.head);
            if (!ctx) return false;
            const e = engine.commit(ctx.before);
            if (!e) return false;
            apply(view, ctx.lineFrom, e, "", true, engine.leaderChar);
            return true;
          },
        },
      ]),
    ),
  ];
}
