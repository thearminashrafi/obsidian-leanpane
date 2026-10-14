/**
 * Lean Unicode abbreviation engine (\to -> →), editor-independent. Wraps the table of @leanprover/unicode-input
 * (only the pure AbbreviationProvider is imported; the package root pulls in `vscode`).
 * Stateless: it looks only at the text before the caret.
 * Known limitation (handled in the editor layer): after `\\` is replaced by a single `\`, that leftover backslash looks
 * like a new leader.
 */
import { AbbreviationProvider } from "@leanprover/unicode-input/dist/AbbreviationProvider";
export interface UnicodeOptions { leader?: string; eager?: boolean; custom?: Record<string, string> }
export interface ActiveAbbreviation { start: number; abbr: string }
export interface UnicodeEdit { from: number; to: number; insert: string; caret: number }
const CUR = "$CURSOR";
function tpl(sym: string): { insert: string; caret: number } {
  const i = sym.indexOf(CUR);
  if (i < 0) return { insert: sym, caret: sym.length };
  return { insert: sym.replace(CUR, ""), caret: i };
}
export class UnicodeEngine {
  private p: AbbreviationProvider; private leader: string; private eager: boolean;
  constructor(o: UnicodeOptions = {}) {
    this.leader = o.leader ?? "\\"; this.eager = o.eager ?? true;
    this.p = new AbbreviationProvider({ abbreviationCharacter: this.leader, customTranslations: o.custom ?? {}, eagerReplacementEnabled: this.eager });
  }
  findActive(before: string): ActiveAbbreviation | null {
    const i = before.lastIndexOf(this.leader);
    if (i < 0) return null;
    const abbr = before.slice(i + this.leader.length);
    if (/\s/.test(abbr)) return null;
    if (abbr && this.p.findSymbolsByAbbreviationPrefix(abbr).length === 0) return null;
    return { start: i, abbr };
  }
  onType(before: string, typed: string): { edit: UnicodeEdit | null; consume: boolean } {
    const a = this.findActive(before);
    if (!a) return { edit: null, consume: false };
    if (typed.length === 1) {
      const next = a.abbr + typed;
      const m = this.p.findSymbolsByAbbreviationPrefix(next);
      if (m.length > 0) {
        if (this.eager && m.length === 1 && this.p.getSymbolForAbbreviation(next) !== undefined) {
          const t = tpl(this.p.getSymbolForAbbreviation(next)!);
          return { edit: { from: a.start, to: before.length, ...t }, consume: true };
        }
        return { edit: null, consume: false };
      }
    }
    if (!a.abbr) return { edit: null, consume: false };
    const r = this.p.getReplacementText(a.abbr);
    if (r === undefined) return { edit: null, consume: false };
    return { edit: { from: a.start, to: before.length, ...tpl(r) }, consume: false };
  }
  commit(before: string): UnicodeEdit | null {
    const a = this.findActive(before);
    if (!a || !a.abbr) return null;
    const r = this.p.getReplacementText(a.abbr);
    return r === undefined ? null : { from: a.start, to: before.length, ...tpl(r) };
  }
  suggestions(prefix: string, limit = 20) {
    return Object.entries(this.p.getSymbolsByAbbreviation()).filter(([k]) => k.startsWith(prefix)).sort((x, y) => x[0].length - y[0].length || (x[0] < y[0] ? -1 : 1)).slice(0, limit).map(([abbr, s]) => ({ abbr, symbol: s.replace(CUR, "") }));
  }
  replacementFor(abbr: string) { const s = this.p.getSymbolForAbbreviation(abbr); return s === undefined ? undefined : s.replace(CUR, ""); }
  abbreviationsFor(symbol: string) { return this.p.collectAllAbbreviations(symbol); }
}
