/**
 * Conversions between CodeMirror document offsets and LSP positions / content changes.
 * Both count UTF-16 code units, so no re-encoding is needed.
 */
import type { ChangeSet, Text } from "@codemirror/state";
import type { Position, Range, TextDocumentContentChangeEvent } from "../types";

export function offsetToPos(doc: Text, offset: number): Position {
  const o = Math.max(0, Math.min(offset, doc.length));
  const line = doc.lineAt(o);
  return { line: line.number - 1, character: o - line.from };
}

export function posToOffset(doc: Text, pos: Position): number {
  if (pos.line < 0) return 0;
  if (pos.line >= doc.lines) return doc.length;
  const line = doc.line(pos.line + 1);
  return Math.min(line.from + Math.max(0, pos.character), line.to);
}

export function rangeToOffsets(doc: Text, r: Range): { from: number; to: number } {
  const from = posToOffset(doc, r.start);
  const to = posToOffset(doc, r.end);
  return { from, to: Math.max(from, to) };
}

/**
 * Incremental LSP changes for one CodeMirror transaction. `changes.iterChanges` reports ranges in the OLD document;
 * LSP applies the events one after another, so they are emitted from the last change to the first (later edits
 * never move earlier positions).
 */
export function changesToLsp(startDoc: Text, changes: ChangeSet): TextDocumentContentChangeEvent[] {
  const out: TextDocumentContentChangeEvent[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    out.push({ range: { start: offsetToPos(startDoc, fromA), end: offsetToPos(startDoc, toA) }, text: inserted.toString() });
  });
  return out.reverse();
}
