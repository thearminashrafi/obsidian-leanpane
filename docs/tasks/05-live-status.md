# Task 05 — Live declaration status (`src/core/liveStatus.ts`)

> You are a careful junior engineer. This file is self-contained: read it fully, then read ONLY the files it names.
> Do not read other files in the repo and do not change anything outside the files listed under "Files you may edit".

## Ground rules (all tasks)
- Repo: `/home/claude/leanpane-build/obsidian-leanpane` (Node 22, TypeScript 5.5 strict, ES modules, vitest 2). Do NOT run `git commit`/`git add`; the lead commits.
- Edit ONLY the files listed under "Files you may edit". Never edit tests, `src/types.ts`, `docs/`, or another task's file. If a test looks wrong or the spec contradicts it, do not "fix" the test: implement the most reasonable behaviour, and describe the problem in your final report.
- `src/core/*` must NOT import `obsidian` or anything from the browser/DOM. Use Node built-ins with the `node:` prefix (`node:path`, `node:fs/promises`, ...). Use `node:path` functions (never hard-coded `/` or `\\` separators) unless the task says otherwise; code must work on macOS, Linux and Windows.
- Keep the exported names and signatures from the contract below EXACTLY (the lead's integration code and the tests import them). You may add extra exports and private helpers inside your file.
- Replace each `throw new Error("TODO(task 05)")` stub with a real implementation. No `any` unless the contract already has it. No `console.log` in library code.
- Style: 2-space indent, double quotes, semicolons, trailing commas, width ~140. Short comments only where the logic is not obvious.
- Other workers edit other files at the same time. `npx tsc --noEmit` may show errors in files you do not own: ignore them; make sure none are in your file (`npx tsc --noEmit 2>&1 | grep <yourfile>`).

## Test command
```
cd /home/claude/leanpane-build/obsidian-leanpane && npx vitest run --project tasks test/unit/liveStatus.test.ts
```
Run it repeatedly while you work. The task is done when every test in the named file(s) passes (or is skipped by its own `skipIf` for a missing tool) and `tsc` shows no errors in your file.

## Final report (your last message)
Keep it short: files changed; test results (passed/failed/skipped counts); any test you believe is wrong or any ambiguity in this spec, with your reasoning; anything the lead must know for integration.

## Purpose
For files that are open, LeanPane shows per-declaration status (proved / contains `sorry` / has errors) and the number of `sorry`s in the status bar, using only what the language server already told us: `textDocument/documentSymbol` (hierarchical) and `textDocument/publishDiagnostics`. This module turns those two inputs into a flat list of declarations with state. Pure functions, no I/O.

## Files you may edit
- `src/core/liveStatus.ts` (stub). May read `src/types.ts`, `test/unit/liveStatus.test.ts` and the real Lean output samples in `test/fixtures/lsp/*.json` (the test loads them; look at `basic.symbols.json`, `symbols.symbols.json`, `basic.diagnostics.json`, `broken.diagnostics.json` and `test/fixtures/lean/status_proj/StatusProj/Symbols.lean`).

## Contract (current content of the stub — keep these signatures)
```ts
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
```

Types used (from `src/types.ts`; `Diagnostic`, `DocumentSymbol`, `Range`, `Position` are the standard LSP types, severity 1=error, 2=warning, 3=info, 4=hint):
```ts
export type LiveDeclState = "error" | "stated" | "proved";

export interface LiveDecl {
  /** Fully qualified name including enclosing namespaces: "StatusProj.proved_add_zero". */
  name: string;
  /** Name as written in the document symbol. */
  shortName: string;
  /** LSP SymbolKind number from documentSymbol (e.g. 12 function, 14 constant, 5 class, 23 struct …). */
  symbolKind: number;
  range: Range;
  selectionRange: Range;
  state: LiveDeclState;
  /** First error message inside the declaration, when state === "error". */
  errorMessage?: string;
}
```

## Facts about Lean's output (verified with Lean 4.25.1)
- `documentSymbol` returns a TREE. Both `namespace X` and `section X` blocks appear as container symbols with `kind: 3` and name `X` (a section is just named by its name, e.g. `Helpers`; an anonymous `section` may have an empty name). Declarations (theorem, def, structure, inductive, instance, …) are symbols with `kind: 6` (and children are rare). Declaration names are as written: `thm`, `Foo.bar`, `_root_.top_level`, `instance : Inhabited Color ` (note the trailing space).
- A `namespace A.B` block may appear as one container named `A.B`.
- `range` spans the declaration (docstring/attributes through the end of the proof); `selectionRange` is the name.
- The "declaration uses 'sorry'" warning (severity 2) is positioned at the declaration NAME (inside `range`).
- `#check`/`#eval` output arrives as severity-3 diagnostics and creates no symbols.

## Behaviour
**computeLiveDecls(symbols, diagnostics, text?)**
1. Depth-first walk in document order. For a container (a symbol with a non-empty `children` array, or kind 3 with `children`): if it is a *namespace* its name is added to the prefix for its children, if it is a *section* it is not. To tell them apart you need `text`: take the line `range.start.line` of `text`; if its trimmed text starts with `section` → section; if it starts with `namespace` (or text is missing, or the line cannot be classified) → namespace. A container with an empty name adds nothing.
2. Every non-container symbol is a declaration. Qualified name: strip a leading `_root_.` from the symbol name and then use NO prefix; otherwise `prefix + "." + name` (prefix may be empty → just name). `shortName` = symbol name `trim()`med. The `name` also uses the trimmed name. Keep symbol order. Fill `symbolKind`, `range`, `selectionRange`.
3. State: look at all diagnostics whose range START line is within `[range.start.line, range.end.line]` of the declaration (inclusive; when several declarations overlap, the innermost/first in document order that contains it wins — simple containment is enough). Any with `severity === 1` → `"error"`, `errorMessage` = message of the FIRST such diagnostic (document order of the diagnostics array). Else any with `severity === 2` whose message contains `sorry` (case-insensitive) → `"stated"`. Else `"proved"`.
   Note: "proved" here only means "no sorry/error in this declaration's own text"; a proof that depends on a `sorry` theorem is detected later by the build query, not here.

**sorryCount(diagnostics)** — number of severity-2 diagnostics whose message contains `sorry` (case-insensitive).
**sorryLines(diagnostics)** — the same diagnostics' `range.start.line`, unique and ascending.
**summarize(decls)** — `{ error, stated, proved }` counts (all three keys always present).

## Tests
`test/unit/liveStatus.test.ts`: real captured Lean data plus synthetic cases. Definition of done.
