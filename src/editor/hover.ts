import { hoverTooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { hoverMarkdown } from "../core/lsp";
import type { LeanEditorHost } from "./host";
import { offsetToPos, rangeToOffsets } from "./lspConvert";

/** Types and docs from `textDocument/hover`, rendered as Markdown with Obsidian's own renderer. */
export function leanHover(host: LeanEditorHost): Extension {
  return hoverTooltip(
    async (view, pos) => {
      if (!host.hoverEnabled()) return null;
      const doc = view.state.doc;
      let res: any;
      try {
        res = await host.request("textDocument/hover", { textDocument: { uri: host.uri() }, position: offsetToPos(doc, pos) });
      } catch {
        return null;
      }
      const md = hoverMarkdown(res);
      if (!md.trim()) return null;
      const r = res?.range ? rangeToOffsets(doc, res.range) : { from: pos, to: pos };
      return {
        pos: r.from,
        end: r.to,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "lp-hover markdown-rendered";
          host.renderMarkdown(md, dom);
          return { dom };
        },
      };
    },
    { hoverTime: 400 },
  );
}
