/**
 * CodeMirror 6 StreamLanguage tokenizer for Lean 4 + highlight style bound to `lp-tok-*` CSS classes.
 * TASK: docs/tasks/09-lean-language.md
 */
import { StreamLanguage, HighlightStyle } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

export declare const leanLanguage: StreamLanguage<unknown>;
export declare const leanHighlight: HighlightStyle;
/** [leanLanguage, syntaxHighlighting(leanHighlight)] */
export function leanSyntax(): Extension {
  throw new Error("TODO(task 09)");
}
