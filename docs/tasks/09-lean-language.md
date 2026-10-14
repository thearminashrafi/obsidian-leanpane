# Task 09 — Lean syntax highlighting for CodeMirror (`src/editor/leanLanguage.ts`)

> You are a careful junior engineer. This file is self-contained: read it fully, then read ONLY the files it names.
> Do not read other files in the repo and do not change anything outside the files listed under "Files you may edit".

## Ground rules (all tasks)
- Repo: `/home/claude/leanpane-build/obsidian-leanpane` (Node 22, TypeScript 5.5 strict, ES modules, vitest 2). Do NOT run `git commit`/`git add`; the lead commits.
- Edit ONLY the files listed under "Files you may edit". Never edit tests, `src/types.ts`, `docs/`, or another task's file. If a test looks wrong or the spec contradicts it, do not "fix" the test: implement the most reasonable behaviour, and describe the problem in your final report.
- `src/core/*` must NOT import `obsidian` or anything from the browser/DOM. Use Node built-ins with the `node:` prefix (`node:path`, `node:fs/promises`, ...). Use `node:path` functions (never hard-coded `/` or `\\` separators) unless the task says otherwise; code must work on macOS, Linux and Windows.
- Keep the exported names and signatures from the contract below EXACTLY (the lead's integration code and the tests import them). You may add extra exports and private helpers inside your file.
- Replace each `throw new Error("TODO(task 09)")` stub with a real implementation. No `any` unless the contract already has it. No `console.log` in library code.
- Style: 2-space indent, double quotes, semicolons, trailing commas, width ~140. Short comments only where the logic is not obvious.
- Other workers edit other files at the same time. `npx tsc --noEmit` may show errors in files you do not own: ignore them; make sure none are in your file (`npx tsc --noEmit 2>&1 | grep <yourfile>`).

## Test command
```
cd /home/claude/leanpane-build/obsidian-leanpane && npx vitest run --project tasks test/unit/leanLanguage.test.ts
```
Run it repeatedly while you work. The task is done when every test in the named file(s) passes (or is skipped by its own `skipIf` for a missing tool) and `tsc` shows no errors in your file.

## Final report (your last message)
Keep it short: files changed; test results (passed/failed/skipped counts); any test you believe is wrong or any ambiguity in this spec, with your reasoning; anything the lead must know for integration.

## Purpose
The Lean editor (CodeMirror 6, inside Obsidian) needs a fast fallback highlighter that works before/without the language server. It is a `StreamLanguage` tokenizer for Lean 4 plus a `HighlightStyle` that maps token kinds to CSS classes `lp-tok-<kind>` (the colours are defined in `styles.css`, already written).

## Files you may edit
- `src/editor/leanLanguage.ts` (stub). May read `test/unit/leanLanguage.test.ts`, `styles.css` (class names), and — as a pattern for custom `Tag`s, `StreamLanguage`, `tokenTable` and `HighlightStyle` with CSS classes — `/home/claude/texpane-build/texpane/src/editor/latexLanguage.ts` (a different, already working plugin; copy its approach, not its LaTeX rules).

## Contract (current content of the stub — keep these exports; replace the `declare`s with real values)
```ts
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
```

Libraries: `@codemirror/language` (`StreamLanguage`, `StreamParser`, `HighlightStyle`, `syntaxHighlighting`), `@lezer/highlight` (`Tag`), `@codemirror/state`. All are installed and are EXTERNAL in the bundle (do not copy them).

## Token kinds → CSS class
`keyword`, `tactic`, `type`, `string`, `number`, `comment`, `doc`, `attribute`, `sorry` → classes `lp-tok-keyword`, `lp-tok-tactic`, … Everything else (plain identifiers, operators, punctuation) is unstyled (return `null`). Define one `Tag` per kind (`Tag.define()`), map stream token names to them with `tokenTable`, and build `leanHighlight = HighlightStyle.define([{ tag, class: "lp-tok-..." }, ...])`.

## Tokenizer rules
State (must be copy-safe; `StreamLanguage` copies state): `blockDepth: number` (nesting depth of `/- ... -/`), `blockKind: "comment" | "doc"`.
- **Block comments** nest. `/--` and `/-!` open a *doc* comment (kind `doc`), plain `/-` a normal comment (kind `comment`). While `blockDepth > 0`, consume text up to and including the next `/-` (depth+1) or `-/` (depth-1); the token class is the comment's kind; the state persists across lines. Unterminated comments simply run to the end of the file.
- **Line comments**: `--` to end of line → `comment`. (Do not treat `---` specially.)
- **Strings**: `"` … `"` with `\` escapes; may span lines (keep a `inString` flag in state) → `string`. **Char literals**: `'x'`, `'\n'`, `'\''`, `'\x41'`, `'\u{1F600}'` → `string`; an apostrophe that is not a valid char literal (e.g. a trailing prime in `x'` — which is consumed as part of the identifier, see below) is not a char literal.
- **Numbers**: `0x[0-9a-fA-F]+`, `0b[01]+`, `0o[0-7]+`, decimals with optional fraction `3.14` and exponent `1e-5`, plain integers → `number`. A number directly followed by identifier characters is still a number token for its digits.
- **Attributes**: `@[` … `]` on one line → `attribute` (one token for the whole bracketed text).
- **Identifiers**: start with a letter (ASCII, Greek except `λ Π Σ`, or letter-like symbols such as ℕ ℤ ℝ), `_`, or `«…»`; continue with letters, digits, `_`, `'`, `!`, `?`, subscripts `₀-₉`, `✝`, and may contain `.` followed by another identifier part (dotted names like `Nat.add_comm`, `xs.length` are ONE token). Classify the whole token:
  - exactly `sorry` or `admit` → `sorry`;
  - in the KEYWORD set → `keyword` (only when the token has no dot);
  - in the TACTIC set → `tactic` (no dot);
  - first character uppercase ASCII (A–Z), or exactly `Prop`, `Type`, `Sort`, or the first dotted segment starts with an uppercase letter (e.g. `Nat.succ`, `List.map`) → `type`;
  - else unstyled.
- `λ`, `fun`, `∀`, `∃`, `Π`, `Σ` → `keyword`. Operators like `→ ↔ ∧ ∨ ¬ ≤ := ⊢ ←` stay unstyled (they are not letters).
- Whitespace and unknown characters: advance one character and return null. The tokenizer must ALWAYS consume at least one character per call (otherwise CodeMirror loops forever).

KEYWORD set: `abbrev add_decl_doc alias axiom class def deriving elab end example export extends from import in include inductive infix infixl infixr initialize instance lemma macro macro_rules mutual namespace noncomputable notation omit open opaque partial postfix prefix private protected public section structure syntax termination_by decreasing_by theorem universe unsafe variable where with at match fun if then else let have show do return for while try catch finally by calc using set_option attribute local scoped irreducible_def theorem lemma nonrec unif_hint declare_syntax_cat register_option run_cmd elab_rules`.
TACTIC set: `intro intros exact apply refine simp simp_all simpa rw rewrite rfl omega induction cases rcases obtain constructor left right exists use ring ring_nf linarith nlinarith norm_num decide trivial contradiction exfalso assumption specialize unfold subst split congr funext ext aesop tauto positivity field_simp push_neg by_contra by_cases rintro rename_i generalize change exact? apply? rw? simp? simp_arith norm_cast push_cast gcongr exacts refine' exact_mod_cast tfae_have conv`.
(`exact?` style names: a trailing `?` or `!` is part of the identifier.)

`leanSyntax()` returns `[leanLanguage, syntaxHighlighting(leanHighlight)]`. Give the language `name: "lean4"` and `languageData: { commentTokens: { line: "--", block: { open: "/-", close: "-/" } } }`.

## Tests
`test/unit/leanLanguage.test.ts` parses strings with `leanLanguage.parser.parse` and runs `highlightTree` with `leanHighlight`. Definition of done.
