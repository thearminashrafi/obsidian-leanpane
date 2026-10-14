/**
 * Live per-declaration status from documentSymbol + diagnostics. Pure. TASK: docs/tasks/05-live-status.md
 */
import type { Diagnostic, DocumentSymbol, LiveDecl, LiveDeclState, Range } from "../types";

const SYMBOL_KIND_NAMESPACE = 3;
const SEVERITY_ERROR = 1;
const SEVERITY_WARNING = 2;

/** Whether a symbol's diagnostics-independent role is a container (namespace or section) rather than a declaration. */
function isContainer(sym: DocumentSymbol): boolean {
  return Array.isArray(sym.children) && (sym.children.length > 0 || sym.kind === SYMBOL_KIND_NAMESPACE);
}

/** Classify a container by the first word of its line in the document. Unknown lines count as namespaces. */
function isSectionAt(text: string | undefined, line: number): boolean {
  if (text === undefined) return false;
  const lineText = text.split(/\r?\n/)[line];
  if (lineText === undefined) return false;
  return /^section(\s|$)/.test(lineText.trim());
}

/** LSP allows the message to be plain text or markup; we only need the text. */
function messageText(d: Diagnostic): string {
  return typeof d.message === "string" ? d.message : d.message.value;
}

function isSorryWarning(d: Diagnostic): boolean {
  return d.severity === SEVERITY_WARNING && messageText(d).toLowerCase().includes("sorry");
}

/** Diagnostics whose start line lies within the declaration's line span (inclusive). */
function diagnosticsWithin(range: Range, diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((d) => d.range.start.line >= range.start.line && d.range.start.line <= range.end.line);
}

function stateOf(range: Range, diagnostics: Diagnostic[]): { state: LiveDeclState; errorMessage?: string } {
  const inside = diagnosticsWithin(range, diagnostics);
  const firstError = inside.find((d) => d.severity === SEVERITY_ERROR);
  if (firstError) return { state: "error", errorMessage: messageText(firstError) };
  if (inside.some(isSorryWarning)) return { state: "stated" };
  return { state: "proved" };
}

/** `_root_.x` escapes the enclosing namespaces; anything else is prefixed by them. */
function qualify(name: string, prefix: string): string {
  const ROOT = "_root_.";
  if (name.startsWith(ROOT)) return name.slice(ROOT.length);
  return prefix ? `${prefix}.${name}` : name;
}

/**
 * Flatten hierarchical document symbols into declarations with fully qualified names and a state.
 * `text` (the document) is optional; it lets us tell `namespace X` containers from `section X` containers.
 */
export function computeLiveDecls(symbols: DocumentSymbol[], diagnostics: Diagnostic[], text?: string): LiveDecl[] {
  const out: LiveDecl[] = [];

  const walk = (syms: DocumentSymbol[], prefix: string): void => {
    for (const sym of syms) {
      const shortName = sym.name.trim();
      if (isContainer(sym)) {
        const addsPrefix = shortName !== "" && !isSectionAt(text, sym.range.start.line);
        const childPrefix = addsPrefix ? (prefix ? `${prefix}.${shortName}` : shortName) : prefix;
        walk(sym.children ?? [], childPrefix);
        continue;
      }

      const { state, errorMessage } = stateOf(sym.range, diagnostics);
      const decl: LiveDecl = {
        name: qualify(shortName, prefix),
        shortName,
        symbolKind: sym.kind,
        range: sym.range,
        selectionRange: sym.selectionRange,
        state,
      };
      if (errorMessage !== undefined) decl.errorMessage = errorMessage;
      out.push(decl);
    }
  };

  walk(symbols, "");
  return out;
}

/** Number of "declaration uses 'sorry'" warnings. */
export function sorryCount(diagnostics: Diagnostic[]): number {
  return diagnostics.filter(isSorryWarning).length;
}

/** Sorted unique 0-based start lines of those warnings. */
export function sorryLines(diagnostics: Diagnostic[]): number[] {
  const lines = new Set(diagnostics.filter(isSorryWarning).map((d) => d.range.start.line));
  return [...lines].sort((a, b) => a - b);
}

export function summarize(decls: LiveDecl[]): Record<LiveDeclState, number> {
  const counts: Record<LiveDeclState, number> = { error: 0, stated: 0, proved: 0 };
  for (const d of decls) counts[d.state]++;
  return counts;
}
