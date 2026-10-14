/**
 * CodeMirror 6 StreamLanguage tokenizer for Lean 4 + highlight style bound to `lp-tok-*` CSS classes.
 * TASK: docs/tasks/09-lean-language.md
 */
import { StreamLanguage, HighlightStyle, syntaxHighlighting, type StreamParser, type StringStream } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { Tag } from "@lezer/highlight";

const leanKeyword = Tag.define();
const leanTactic = Tag.define();
const leanType = Tag.define();
const leanString = Tag.define();
const leanNumber = Tag.define();
const leanComment = Tag.define();
const leanDoc = Tag.define();
const leanAttribute = Tag.define();
const leanSorry = Tag.define();

const KEYWORDS = new Set(
  (
    "abbrev add_decl_doc alias axiom class def deriving elab end example export extends from import in include inductive infix infixl infixr " +
    "initialize instance lemma macro macro_rules mutual namespace noncomputable notation omit open opaque partial postfix prefix private " +
    "protected public section structure syntax termination_by decreasing_by theorem universe unsafe variable where with at match fun if then " +
    "else let have show do return for while try catch finally by calc using set_option attribute local scoped irreducible_def theorem lemma " +
    "nonrec unif_hint declare_syntax_cat register_option run_cmd elab_rules"
  ).split(/\s+/),
);

const TACTICS = new Set(
  (
    "intro intros exact apply refine simp simp_all simpa rw rewrite rfl omega induction cases rcases obtain constructor left right exists use " +
    "ring ring_nf linarith nlinarith norm_num decide trivial contradiction exfalso assumption specialize unfold subst split congr funext ext " +
    "aesop tauto positivity field_simp push_neg by_contra by_cases rintro rename_i generalize change exact? apply? rw? simp? simp_arith " +
    "norm_cast push_cast gcongr exacts refine' exact_mod_cast tfae_have conv"
  ).split(/\s+/),
);

// Identifier characters: ASCII letters, Greek (except λ Π Σ), letter-like symbols (ℕ ℤ ℝ ...), `_`.
const LETTER = String.raw`(?![λΠΣ])[A-Za-z_Α-Ωα-ωἀ-῿℀-⅏\u{1D49C}-\u{1D59F}]`;
const CONT = String.raw`(?:${LETTER}|[0-9!?'₀-₉✝])`;
const SEG = String.raw`(?:${LETTER}${CONT}*|«[^»\n]*»)`;
const IDENT = new RegExp(String.raw`^${SEG}(?:\.${SEG})*`, "u");
const NUMBER = /^(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/;
const CHAR = /^'(?:[^'\\\n]|\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.))'/u;
const ATTRIBUTE = /^@\[[^\]\n]*\]/;

interface LeanState {
  /** nesting depth of block comments; 0 when outside one */
  blockDepth: number;
  blockKind: "comment" | "doc";
  inString: boolean;
}

/** Consumes the rest of the current line inside a (possibly nested) block comment. */
function scanBlock(stream: StringStream, s: LeanState): string {
  while (!stream.eol()) {
    if (stream.match("/-")) {
      s.blockDepth++;
    } else if (stream.match("-/")) {
      s.blockDepth--;
      if (s.blockDepth === 0) break;
    } else {
      stream.next();
    }
  }
  return s.blockKind === "doc" ? "lean-doc" : "lean-comment";
}

/** Consumes the rest of the current line inside a string literal. */
function scanString(stream: StringStream, s: LeanState): string {
  while (!stream.eol()) {
    const c = stream.next();
    if (c === "\\") {
      if (!stream.eol()) stream.next();
    } else if (c === '"') {
      s.inString = false;
      break;
    }
  }
  return "lean-string";
}

function classifyIdent(text: string): string | null {
  if (text === "sorry" || text === "admit") return "lean-sorry";
  if (!text.includes(".")) {
    if (KEYWORDS.has(text)) return "lean-keyword";
    if (TACTICS.has(text)) return "lean-tactic";
  }
  const head = text.split(".")[0] ?? "";
  if (/^[A-Z]/.test(head) || text === "Prop" || text === "Type" || text === "Sort") return "lean-type";
  return null;
}

const parser: StreamParser<LeanState> = {
  name: "lean4",
  startState: (): LeanState => ({ blockDepth: 0, blockKind: "comment", inString: false }),
  copyState: (s: LeanState): LeanState => ({ ...s }),
  token(stream, s): string | null {
    if (s.blockDepth > 0) return scanBlock(stream, s);
    if (s.inString) return scanString(stream, s);
    if (stream.eatSpace()) return null;

    if (stream.match("/--") || stream.match("/-!")) {
      s.blockDepth = 1;
      s.blockKind = "doc";
      return scanBlock(stream, s);
    }
    if (stream.match("/-")) {
      s.blockDepth = 1;
      s.blockKind = "comment";
      return scanBlock(stream, s);
    }
    if (stream.match("--")) {
      stream.skipToEnd();
      return "lean-comment";
    }

    const ch = stream.peek();
    if (ch === '"') {
      stream.next();
      s.inString = true;
      return scanString(stream, s);
    }
    if (ch === "'") {
      if (stream.match(CHAR)) return "lean-string";
      stream.next();
      return null;
    }
    if (stream.match(ATTRIBUTE)) return "lean-attribute";
    if (ch === "λ" || ch === "∀" || ch === "∃" || ch === "Π" || ch === "Σ") {
      stream.next();
      return "lean-keyword";
    }
    if (stream.match(NUMBER)) return "lean-number";
    if (stream.match(IDENT)) return classifyIdent(stream.current());

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "--", block: { open: "/-", close: "-/" } },
  },
  tokenTable: {
    "lean-keyword": leanKeyword,
    "lean-tactic": leanTactic,
    "lean-type": leanType,
    "lean-string": leanString,
    "lean-number": leanNumber,
    "lean-comment": leanComment,
    "lean-doc": leanDoc,
    "lean-attribute": leanAttribute,
    "lean-sorry": leanSorry,
  },
};

export const leanLanguage: StreamLanguage<unknown> = StreamLanguage.define(parser);

export const leanHighlight: HighlightStyle = HighlightStyle.define([
  { tag: leanKeyword, class: "lp-tok-keyword" },
  { tag: leanTactic, class: "lp-tok-tactic" },
  { tag: leanType, class: "lp-tok-type" },
  { tag: leanString, class: "lp-tok-string" },
  { tag: leanNumber, class: "lp-tok-number" },
  { tag: leanComment, class: "lp-tok-comment" },
  { tag: leanDoc, class: "lp-tok-doc" },
  { tag: leanAttribute, class: "lp-tok-attribute" },
  { tag: leanSorry, class: "lp-tok-sorry" },
]);

/** [leanLanguage, syntaxHighlighting(leanHighlight)] */
export function leanSyntax(): Extension {
  return [leanLanguage, syntaxHighlighting(leanHighlight)];
}
