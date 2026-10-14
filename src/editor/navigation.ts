import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { LeanEditorHost } from "./host";

const MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const isMod = (e: { metaKey: boolean; ctrlKey: boolean }): boolean => (MAC ? e.metaKey : e.ctrlKey);

/** F12 and Mod+click go to the definition; holding Mod turns the cursor into a pointer. */
export function leanNavigation(host: LeanEditorHost): Extension {
  return [
    Prec.high(
      keymap.of([
        {
          key: "F12",
          run: (view) => {
            host.gotoDefinition(view.state.selection.main.head, false);
            return true;
          },
        },
      ]),
    ),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || !isMod(e)) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        e.preventDefault();
        host.gotoDefinition(pos, e.altKey);
        return true;
      },
      keydown(e, view) {
        if (isMod(e)) view.dom.classList.add("lp-mod-held");
        return false;
      },
      keyup(e, view) {
        if (!isMod(e)) view.dom.classList.remove("lp-mod-held");
        return false;
      },
      blur(_e, view) {
        view.dom.classList.remove("lp-mod-held");
        return false;
      },
    }),
  ];
}
