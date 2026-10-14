/**
 * Small pure helpers around the Lean language server protocol (no "obsidian", no CodeMirror, no I/O).
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import type { Diagnostic, Position, Range } from "../types";

export function pathToUri(abs: string): string {
  return pathToFileURL(abs).href;
}

/** Absolute path of a file:// URI, or null for other schemes / malformed input. */
export function uriToPath(uri: string): string | null {
  if (!uri.startsWith("file:")) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

/** Do two URIs name the same file? (percent-encoding and drive-letter case differences are ignored) */
export function sameUri(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = uriToPath(a);
  const pb = uriToPath(b);
  if (pa === null || pb === null) return false;
  return path.resolve(pa) === path.resolve(pb);
}

// ---------------------------------------------------------------------------------------------------------------
// Semantic tokens
// ---------------------------------------------------------------------------------------------------------------
export interface SemanticLegend {
  tokenTypes: string[];
  tokenModifiers: string[];
}
export interface SemanticToken {
  line: number;
  char: number;
  length: number;
  type: string;
  modifiers: string[];
}

/** Decode the relative `data` array of `textDocument/semanticTokens/full`. Unknown type indices are dropped. */
export function decodeSemanticTokens(data: number[], legend: SemanticLegend): SemanticToken[] {
  const out: SemanticToken[] = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const dl = data[i];
    const dc = data[i + 1];
    line += dl;
    char = dl === 0 ? char + dc : dc;
    const type = legend.tokenTypes[data[i + 3]];
    if (type === undefined) continue;
    const bits = data[i + 4];
    const modifiers: string[] = [];
    legend.tokenModifiers.forEach((m, k) => {
      if (bits & (1 << k)) modifiers.push(m);
    });
    out.push({ line, char, length: data[i + 2], type, modifiers });
  }
  return out;
}

/** CSS class for a semantic token type, or null when the plain tokenizer is good enough. */
export function semanticClass(type: string): string | null {
  switch (type) {
    case "function":
    case "method":
      return "lp-sem-function";
    case "type":
    case "class":
    case "struct":
    case "enum":
    case "interface":
    case "typeParameter":
      return "lp-sem-type";
    case "property":
      return "lp-sem-property";
    case "namespace":
      return "lp-sem-namespace";
    case "enumMember":
      return "lp-sem-const";
    case "macro":
      return "lp-sem-macro";
    case "leanSorryLike":
      return "lp-sem-sorry";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Hover, definition, completion shapes
// ---------------------------------------------------------------------------------------------------------------
type MarkedString = string | { language: string; value: string };
export interface HoverResult {
  contents: string | { kind?: string; value: string } | MarkedString | MarkedString[];
  range?: Range;
}

/** Markdown text of a hover result ("" when empty). */
export function hoverMarkdown(h: HoverResult | null | undefined): string {
  if (!h) return "";
  const one = (c: MarkedString | { kind?: string; value: string }): string => {
    if (typeof c === "string") return c;
    if ("language" in c && c.language) return "```" + c.language + "\n" + c.value + "\n```";
    return c.value;
  };
  const c = h.contents;
  if (Array.isArray(c)) return c.map(one).filter((s) => s.trim() !== "").join("\n\n");
  return one(c);
}

export interface DefinitionTarget {
  uri: string;
  /** The identifier range (targetSelectionRange for links). */
  range: Range;
}
/** Normalise Location | Location[] | LocationLink[] | null. */
export function definitionTargets(res: unknown): DefinitionTarget[] {
  if (!res) return [];
  const arr = Array.isArray(res) ? res : [res];
  const out: DefinitionTarget[] = [];
  for (const r of arr as Array<Record<string, any>>) {
    if (typeof r?.targetUri === "string") out.push({ uri: r.targetUri, range: r.targetSelectionRange ?? r.targetRange });
    else if (typeof r?.uri === "string" && r.range) out.push({ uri: r.uri, range: r.range });
  }
  return out;
}

/** LSP CompletionItemKind -> CodeMirror completion type. */
export function completionType(kind: number | undefined): string | undefined {
  switch (kind) {
    case 2:
    case 3:
    case 4:
      return "function";
    case 5:
    case 10:
      return "property";
    case 6:
      return "variable";
    case 7:
    case 8:
    case 22:
      return "class";
    case 9:
      return "namespace";
    case 13:
    case 20:
    case 23:
      return "constant";
    case 14:
      return "keyword";
    case 15:
      return "text";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Progress and messages
// ---------------------------------------------------------------------------------------------------------------
export interface ProgressRange {
  range: Range;
  kind?: number;
}
/** Fraction (0..1) of the file's lines that are no longer being processed. 1 when nothing is processing. */
export function progressFraction(processing: ProgressRange[], totalLines: number): number {
  if (processing.length === 0 || totalLines <= 0) return 1;
  let first = Infinity;
  for (const p of processing) first = Math.min(first, p.range.start.line);
  // Lean elaborates top to bottom: everything above the first processing line is done.
  return Math.max(0, Math.min(1, first / totalLines));
}

export function diagnosticText(d: Diagnostic): string {
  return typeof d.message === "string" ? d.message : d.message.value;
}

export type Severity = "error" | "warning" | "info";
export function severityOf(d: Diagnostic): Severity {
  return d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info";
}

/** Is this the `declaration uses 'sorry'` warning? */
export function isSorryWarning(d: Diagnostic): boolean {
  return d.severity === 2 && diagnosticText(d).toLowerCase().includes("sorry");
}

export function comparePositions(a: Position, b: Position): number {
  return a.line - b.line || a.character - b.character;
}

/** Index of the next (dir 1) or previous (dir -1) diagnostic relative to `pos`, wrapping around; -1 when empty. */
export function stepDiagnostic(diags: Diagnostic[], pos: Position, dir: 1 | -1): number {
  if (diags.length === 0) return -1;
  const order = diags.map((d, i) => i).sort((x, y) => comparePositions(diags[x].range.start, diags[y].range.start) || x - y);
  if (dir === 1) {
    for (const i of order) if (comparePositions(diags[i].range.start, pos) > 0) return i;
    return order[0];
  }
  for (let k = order.length - 1; k >= 0; k--) if (comparePositions(diags[order[k]].range.start, pos) < 0) return order[k];
  return order[order.length - 1];
}

// ---------------------------------------------------------------------------------------------------------------
// Lean names, labels and stubs
// ---------------------------------------------------------------------------------------------------------------
/** Symbol kind (LSP number from documentSymbol) -> a human label used in the outline. */
export function symbolKindLabel(kind: number): string {
  switch (kind) {
    case 5:
    case 11:
      return "class";
    case 6:
      return "theorem";
    case 10:
      return "inductive";
    case 12:
    case 14:
      return "def";
    case 23:
      return "structure";
    case 13:
      return "variable";
    default:
      return "decl";
  }
}

/** `/-- ... -/` block for a docstring; "-/" inside the text cannot terminate it early. */
export function docComment(text: string): string {
  const body = text.replace(/-\//g, "- /").trim();
  if (body === "") return "";
  if (!body.includes("\n")) return `/-- ${body} -/\n`;
  return `/--\n${body}\n-/\n`;
}

/** Text appended to a Lean file for a new stub declaration. */
export function stubBlock(name: string, docstring: string): string {
  return `${docComment(docstring)}theorem ${name} : sorry := by\n  sorry\n`;
}

/** Line (1-based) of the first line of `stubBlock` after appending it to `existing` with a separating blank line. */
export function appendStub(existing: string, block: string): { text: string; line: number } {
  let base = existing;
  if (base !== "" && !base.endsWith("\n")) base += "\n";
  if (base !== "" && !base.endsWith("\n\n")) base += "\n";
  const line = base === "" ? 1 : base.split("\n").length;
  return { text: base + block, line };
}

/** `lem:bound_one` style default LaTeX label for a Lean name: last component, env prefix by kind. */
export function defaultBlueprintLabel(leanName: string, kind: string): string {
  const last = leanName.split(".").pop() ?? leanName;
  const prefix = kind === "def" || kind === "structure" || kind === "class" || kind === "inductive" ? "def" : kind === "theorem" ? "lem" : "lem";
  return `${prefix}:${last.replace(/[^A-Za-z0-9_'-]/g, "_")}`;
}
export function defaultBlueprintEnv(kind: string): string {
  return kind === "def" || kind === "structure" || kind === "class" || kind === "inductive" ? "definition" : "lemma";
}
