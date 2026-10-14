/** LSP semantic tokens drawn as mark decorations over the StreamLanguage highlighting. */
import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { semanticClass, type SemanticToken } from "../core/lsp";

export const setSemanticDecorations = StateEffect.define<DecorationSet>();

const field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setSemanticDecorations)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const marks = new Map<string, Decoration>();
function markFor(cls: string): Decoration {
  let m = marks.get(cls);
  if (!m) {
    m = Decoration.mark({ class: cls });
    marks.set(cls, m);
  }
  return m;
}

/** Decoration set for tokens (which must be in document order, as the server sends them). */
export function buildSemanticDecorations(doc: Text, tokens: SemanticToken[]): DecorationSet {
  const ranges = [];
  for (const t of tokens) {
    const cls = semanticClass(t.type);
    if (!cls || t.line >= doc.lines || t.length <= 0) continue;
    const line = doc.line(t.line + 1);
    const from = line.from + t.char;
    const to = Math.min(from + t.length, line.to);
    if (from >= to) continue;
    ranges.push(markFor(cls).range(from, to));
  }
  return Decoration.set(ranges, true);
}

export const semanticTokensExtension = (): Extension => field;
