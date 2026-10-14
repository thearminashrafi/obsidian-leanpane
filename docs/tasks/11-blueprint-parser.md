# Task 11 — Blueprint parser for TeXPane (`src/core/blueprint.ts` in the TeXPane repo)

> You are a careful junior engineer. This file is self-contained: read it fully, then read ONLY the files it names.
> Do not read other files in the repo and do not change anything outside the files listed under "Files you may edit".

## Ground rules (all tasks)
- Repo: `/home/claude/texpane-build/texpane` (Node 22, TypeScript 5.5 strict, ES modules, vitest 2). Do NOT run `git commit`/`git add`; the lead commits.
- Edit ONLY the files listed under "Files you may edit". Never edit tests, `src/types.ts`, `docs/`, or another task's file. If a test looks wrong or the spec contradicts it, do not "fix" the test: implement the most reasonable behaviour, and describe the problem in your final report.
- `src/core/*` must NOT import `obsidian` or anything from the browser/DOM. Use Node built-ins with the `node:` prefix (`node:path`, `node:fs/promises`, ...). Use `node:path` functions (never hard-coded `/` or `\\` separators) unless the task says otherwise; code must work on macOS, Linux and Windows.
- Keep the exported names and signatures from the contract below EXACTLY (the lead's integration code and the tests import them). You may add extra exports and private helpers inside your file.
- Replace each `throw new Error("TODO(task 11)")` stub with a real implementation. No `any` unless the contract already has it. No `console.log` in library code.
- Style: 2-space indent, double quotes, semicolons, trailing commas, width ~140. Short comments only where the logic is not obvious.
- Other workers edit other files at the same time. `npx tsc --noEmit` may show errors in files you do not own: ignore them; make sure none are in your file (`npx tsc --noEmit 2>&1 | grep <yourfile>`).

## Test command
```
cd /home/claude/texpane-build/texpane && npx vitest run test/blueprint.test.ts   # then the whole suite: npx vitest run
```
Run it repeatedly while you work. The task is done when every test in the named file(s) passes (or is skipped by its own `skipIf` for a missing tool) and `tsc` shows no errors in your file.

## Final report (your last message)
Keep it short: files changed; test results (passed/failed/skipped counts); any test you believe is wrong or any ambiguity in this spec, with your reasoning; anything the lead must know for integration.

## Purpose
TeXPane (an Obsidian LaTeX plugin) is getting "blueprint" support: LaTeX written in the style of `leanblueprint`, where each theorem-like environment is linked to Lean declarations with macros:
```
\begin{lemma}[Optional title]
  \label{lem:bound}
  \lean{Foo.bound, Foo.bound_aux}   % Lean names (comma separated, may span lines)
  \uses{def:x, lem:y}               % statements this one depends on
  \leanok                            % the statement is formalised
  \mathlibok                         % the statement is in Mathlib
  \notready                          % not ready to be formalised
  ...
\end{lemma}
\begin{proof}
  \uses{lem:z}                      % dependencies of the PROOF
  \leanok                            % the proof is formalised
\end{proof}
```
This module parses the project's `.tex` sources into a list of nodes. Pure functions, no Obsidian imports.

## Files you may edit
- `src/core/blueprint.ts` (stub, in the TeXPane repo `/home/claude/texpane-build/texpane`). You may read: `test/blueprint.test.ts` (the definition of done), `src/core/indexers.ts` (it exports `stripComment(line)`, which removes an unescaped trailing `%` comment from ONE line — reuse it), `src/types.ts` if you want to see TeXPane's style.
- Do not edit anything else in that repo and do not touch the LeanPane repo.

## Contract (current content of the stub — keep these signatures; `BlueprintNode` fields are final)
```ts
/**
 * Blueprint (leanblueprint-style) parser. Pure. TASK: docs/tasks in the LeanPane repo (11-blueprint-parser.md).
 */
export interface BlueprintNode {
  label: string;
  /** theorem | lemma | proposition | corollary | definition */
  env: string;
  title?: string;
  file: string;
  /** 1-based line of \begin{env} */
  line: number;
  /** 1-based line of \end{env} */
  endLine: number;
  lean: string[];
  leanok: boolean;
  mathlibok: boolean;
  notready: boolean;
  /** \uses inside the statement */
  uses: string[];
  /** \uses inside the attached proof */
  proofUses: string[];
  proofLeanok: boolean;
  proofLine?: number;
  proofEndLine?: number;
}
export interface BlueprintSource {
  file: string;
  text: string;
}

/** `sources` are in document order (root first, \input files where they are included). */
export function parseBlueprint(_sources: BlueprintSource[], _opts?: { extraEnvs?: string[] }): BlueprintNode[] {
  throw new Error("TODO(task 11)");
}

/** Lean name -> nodes mentioning it, in document order. */
export function nodesByLeanName(_nodes: BlueprintNode[]): Map<string, BlueprintNode[]> {
  throw new Error("TODO(task 11)");
}
```

## Behaviour
**Input** — `parseBlueprint(sources, opts?)`: `sources` is an ordered list of `{file, text}` (root file and its `\input` files in document order; the caller resolves them). Process them in order as one continuous document (so a proof in `b.tex` may belong to a lemma in `a.tex`). Return nodes in order of appearance.

**Pre-processing** — split each text into lines (`\r\n` or `\n`; line numbers are 1-based and must be preserved); strip comments with `stripComment` line by line BEFORE scanning (so commented-out macros and `\end{lemma}` are ignored; `\%` stays).

**Statement environments** — `\begin{env}` … `\end{env}` for env in `theorem, lemma, proposition, corollary, definition` plus `opts.extraEnvs`. Starred versions (`lemma*`) are NOT blueprint nodes. Environments nested inside a statement (itemize, equation, …) are part of its body; if the same environment name is nested in itself, match by depth. `line` = line of `\begin{env}`, `endLine` = line of the matching `\end{env}` (an unterminated environment ends at the last line of the file). An optional title follows `\begin{env}` immediately (whitespace allowed): `[Title]`, may contain nested `[...]`/braces; trim it; omit `title` when absent.
Inside the statement body, in text order:
- `\label{x}` (first label wins; a statement WITHOUT a label produces no node);
- `\lean{a, b}` → `lean` (split on commas, trim whitespace/newlines, drop empties, keep order, remove duplicates; several `\lean` macros accumulate);
- `\uses{a, b}` → `uses` (same rules);
- `\leanok`, `\mathlibok`, `\notready` → boolean flags. (Be careful that `\leanok` is not matched inside `\leanokay` — require that the next character is not a letter.)
- Macro arguments may span lines: the whole body is matched as one string (after comment stripping), so `\lean{ A.b ,\n C.d }` works. Names may contain `.`, `_`, `'`, `«»`, digits, spaces inside `«»`.
- `\discussion{n}` and everything else is ignored.

**Proofs** — a `\begin{proof}` … `\end{proof}` attaches to the most recent statement node seen so far (across files), or — if the proof body contains `\proves{label}` — to the node with that label. Inside the proof body: `\uses{...}` → `proofUses` (accumulate, unique), `\leanok` → `proofLeanok = true`, and record `proofLine`/`proofEndLine` (lines of its begin/end). If no node exists yet (or `\proves` names an unknown label) the proof is ignored. A proof's macros never leak into the statement and vice versa. Other environments (remark, example, …) between a statement and its proof do NOT detach the proof. A second proof for the same node: merge (OR the flags, union the uses, keep the first proofLine).

**Defaults** — a node starts with `lean: [], uses: [], proofUses: [], leanok/mathlibok/notready/proofLeanok: false`.

**nodesByLeanName(nodes)** — `Map<leanName, BlueprintNode[]>` in document order.

## Robustness
Never throw: empty input → `[]`; garbage and unterminated constructs → best effort. Performance: a 5,000-line file must parse in well under 100 ms (scan once; no quadratic regex on the whole text per node).

## Tests
`npx vitest run test/blueprint.test.ts` must pass, and the rest of TeXPane's suite must stay green (`npx vitest run`; it should only differ by this one new file). Also run `npx tsc --noEmit`.
