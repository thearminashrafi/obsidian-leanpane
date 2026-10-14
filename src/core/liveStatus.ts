/**
 * Live per-declaration status from documentSymbol + diagnostics. Pure. TASK: docs/tasks/05-live-status.md
 */
import type { Diagnostic, DocumentSymbol, LiveDecl, LiveDeclState } from "../types";

/**
 * Flatten hierarchical document symbols into declarations with fully qualified names and a state.
 * `text` (the document) is optional; it lets us tell `namespace X` containers from `section X` containers.
 */
export function computeLiveDecls(_symbols: DocumentSymbol[], _diagnostics: Diagnostic[], _text?: string): LiveDecl[] {
  throw new Error("TODO(task 05)");
}

/** Number of "declaration uses 'sorry'" warnings. */
export function sorryCount(_diagnostics: Diagnostic[]): number {
  throw new Error("TODO(task 05)");
}

/** Sorted unique 0-based start lines of those warnings. */
export function sorryLines(_diagnostics: Diagnostic[]): number[] {
  throw new Error("TODO(task 05)");
}

export function summarize(_decls: LiveDecl[]): Record<LiveDeclState, number> {
  throw new Error("TODO(task 05)");
}
