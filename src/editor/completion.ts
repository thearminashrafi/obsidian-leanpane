import { autocompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { completionType } from "../core/lsp";
import type { LeanEditorHost } from "./host";
import { offsetToPos } from "./lspConvert";

const WORD = /[\p{L}\p{N}_.'!?₀-₉]*/u;
const MAX_ITEMS = 2000;

function docText(d: unknown): string | undefined {
  if (typeof d === "string") return d;
  if (d && typeof (d as { value?: unknown }).value === "string") return (d as { value: string }).value;
  return undefined;
}

/** Completion from `textDocument/completion` (identifiers, namespaces, hypotheses, tactics). */
function serverSource(host: LeanEditorHost): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const word = ctx.matchBefore(WORD);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const unicode = host.unicode();
    const line = ctx.state.doc.lineAt(ctx.pos);
    if (unicode?.findActive(line.text.slice(0, ctx.pos - line.from))) return null; // typing an abbreviation: other source
    const ac = new AbortController();
    ctx.addEventListener("abort", () => ac.abort());
    let res: any;
    try {
      res = await host.request(
        "textDocument/completion",
        { textDocument: { uri: host.uri() }, position: offsetToPos(ctx.state.doc, ctx.pos), context: { triggerKind: ctx.explicit ? 1 : 2 } },
        ac.signal,
      );
    } catch {
      return null;
    }
    const items: any[] = Array.isArray(res) ? res : (res?.items ?? []);
    if (items.length === 0) return null;
    const options: Completion[] = items.slice(0, MAX_ITEMS).map((it) => {
      const c: Completion = { label: String(it.label), type: completionType(it.kind) };
      if (typeof it.detail === "string") c.detail = it.detail;
      const info = docText(it.documentation);
      if (info) c.info = info;
      return c;
    });
    return { from: word.from, options, validFor: /^[\p{L}\p{N}_.'!?₀-₉]*$/u };
  };
}

/** Offers the Unicode abbreviations once a leader (`\`) has been typed. */
function unicodeSource(host: LeanEditorHost): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const engine = host.unicode();
    if (!engine) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const active = engine.findActive(before);
    if (!active) return null;
    const options = engine.suggestions(active.abbr, 30).map((s): Completion => {
      const leader = before.slice(active.start, active.start + (before.length - active.start - active.abbr.length));
      return { label: leader + s.abbr, detail: s.symbol, apply: s.symbol, type: "text" };
    });
    if (options.length === 0) return null;
    return { from: line.from + active.start, options, filter: false };
  };
}

export function leanCompletion(host: LeanEditorHost): Extension {
  return autocompletion({ override: [unicodeSource(host), serverSource(host)], icons: true, defaultKeymap: true });
}
