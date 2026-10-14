import { setDiagnostics, lintGutter, type Diagnostic as CMDiagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { Text } from "@codemirror/state";
import type { Diagnostic } from "../types";
import { diagnosticText, severityOf } from "../core/lsp";
import { rangeToOffsets } from "./lspConvert";

export const diagnosticsGutter = () => lintGutter();

/** LSP diagnostics -> CodeMirror diagnostics. Empty ranges are widened to one character so a squiggle is visible. */
export function toCMDiagnostics(doc: Text, diags: Diagnostic[]): CMDiagnostic[] {
  const out: CMDiagnostic[] = [];
  for (const d of diags) {
    let { from, to } = rangeToOffsets(doc, d.range);
    if (to <= from) {
      const line = doc.lineAt(Math.min(from, doc.length));
      if (from < line.to) to = from + 1;
      else if (from > line.from) from = from - 1;
      else continue;
    }
    out.push({ from, to, severity: severityOf(d), message: diagnosticText(d), source: "Lean" });
  }
  return out;
}

export function applyDiagnostics(view: EditorView, diags: Diagnostic[]): void {
  view.dispatch(setDiagnostics(view.state, toCMDiagnostics(view.state.doc, diags)));
}
