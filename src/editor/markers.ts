/**
 * Gutter decorations driven by the language server:
 *  - a thin progress bar next to lines Lean is still elaborating (`$/lean/fileProgress`);
 *  - an orange marker and a faint line tint on lines that carry a `sorry` warning.
 */
import { RangeSet, StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from "@codemirror/view";

class ProgressMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "lp-progress-mark";
    return el;
  }
}
class SorryMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "lp-sorry-mark";
    el.title = "This declaration uses sorry";
    return el;
  }
}
const progressMarker = new ProgressMarker();
const sorryMarker = new SorryMarker();

/** 0-based inclusive line spans being processed. */
export const setProcessing = StateEffect.define<Array<{ from: number; to: number }>>();
/** 0-based lines with a sorry warning. */
export const setSorryLines = StateEffect.define<number[]>();

function lineStarts(state: { doc: { lines: number; line(n: number): { from: number } } }, lines: Iterable<number>): number[] {
  const out = new Set<number>();
  for (const l of lines) if (l >= 0 && l < state.doc.lines) out.add(state.doc.line(l + 1).from);
  return [...out].sort((a, b) => a - b);
}

const progressField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setProcessing)) continue;
      const lines: number[] = [];
      for (const s of e.value) for (let l = s.from; l <= s.to && l < tr.state.doc.lines; l++) lines.push(l);
      set = RangeSet.of(lineStarts(tr.state, lines).map((p) => progressMarker.range(p)));
    }
    return set;
  },
});

const sorryField = StateField.define<{ gutter: RangeSet<GutterMarker>; lines: DecorationSet }>({
  create: () => ({ gutter: RangeSet.empty, lines: Decoration.none }),
  update(v, tr) {
    let { gutter: g, lines } = v;
    if (tr.docChanged) {
      g = g.map(tr.changes);
      lines = lines.map(tr.changes);
    }
    for (const e of tr.effects) {
      if (!e.is(setSorryLines)) continue;
      const starts = lineStarts(tr.state, e.value);
      g = RangeSet.of(starts.map((p) => sorryMarker.range(p)));
      lines = Decoration.set(starts.map((p): Range<Decoration> => Decoration.line({ class: "lp-sorry-line" }).range(p)));
    }
    return { gutter: g, lines };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.lines),
});

export function leanMarkers(): Extension {
  return [
    progressField,
    sorryField,
    gutter({ class: "lp-gutter-progress", markers: (v) => v.state.field(progressField) }),
    gutter({ class: "lp-gutter-sorry", markers: (v) => v.state.field(sorryField).gutter }),
  ];
}
