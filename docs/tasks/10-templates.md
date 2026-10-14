# Task 10 — New project / file templates and blueprint skeleton (`src/core/templates.ts`)

> You are a careful junior engineer. This file is self-contained: read it fully, then read ONLY the files it names.
> Do not read other files in the repo and do not change anything outside the files listed under "Files you may edit".

## Ground rules (all tasks)
- Repo: `/home/claude/leanpane-build/obsidian-leanpane` (Node 22, TypeScript 5.5 strict, ES modules, vitest 2). Do NOT run `git commit`/`git add`; the lead commits.
- Edit ONLY the files listed under "Files you may edit". Never edit tests, `src/types.ts`, `docs/`, or another task's file. If a test looks wrong or the spec contradicts it, do not "fix" the test: implement the most reasonable behaviour, and describe the problem in your final report.
- `src/core/*` must NOT import `obsidian` or anything from the browser/DOM. Use Node built-ins with the `node:` prefix (`node:path`, `node:fs/promises`, ...). Use `node:path` functions (never hard-coded `/` or `\\` separators) unless the task says otherwise; code must work on macOS, Linux and Windows.
- Keep the exported names and signatures from the contract below EXACTLY (the lead's integration code and the tests import them). You may add extra exports and private helpers inside your file.
- Replace each `throw new Error("TODO(task 10)")` stub with a real implementation. No `any` unless the contract already has it. No `console.log` in library code.
- Style: 2-space indent, double quotes, semicolons, trailing commas, width ~140. Short comments only where the logic is not obvious.
- Other workers edit other files at the same time. `npx tsc --noEmit` may show errors in files you do not own: ignore them; make sure none are in your file (`npx tsc --noEmit 2>&1 | grep <yourfile>`).

## Test command
```
cd /home/claude/leanpane-build/obsidian-leanpane && npx vitest run --project tasks test/unit/templates.test.ts
```
Run it repeatedly while you work. The task is done when every test in the named file(s) passes (or is skipped by its own `skipIf` for a missing tool) and `tsc` shows no errors in your file.

## Final report (your last message)
Keep it short: files changed; test results (passed/failed/skipped counts); any test you believe is wrong or any ambiguity in this spec, with your reasoning; anything the lead must know for integration.

## Purpose
"New Lean project" in LeanPane runs `lake new <name>` and optionally adds a *blueprint* (the LaTeX side of a formalisation project, compatible with `leanblueprint`): `blueprint/src/{content,print,web}.tex` and `macros/{common,print,web}.tex`, plus one starter lemma tied to a starter Lean theorem that still contains `sorry`. This module only produces the text (no file I/O). The `print.tex` must compile with plain pdfLaTeX (the TeXPane plugin compiles it), so the blueprint macros (`\lean`, `\leanok`, `\uses`, …), which only mean something to leanblueprint's web build, are defined as no-ops there.

## Files you may edit
- `src/core/templates.ts` (stub). May read `src/types.ts`, `test/unit/templates.test.ts`.

## Contract (current content of the stub — keep these signatures)
```ts
/**
 * Templates for new Lean files/projects and the blueprint skeleton. Pure strings, no I/O. TASK: docs/tasks/10-templates.md
 */
import type { TemplateFile } from "../types";

export function sanitizeProjectName(_name: string): string {
  throw new Error("TODO(task 10)");
}
export function libNameFor(_projectName: string): string {
  throw new Error("TODO(task 10)");
}
export function lakeNewArgs(_o: { name: string; mathlib: boolean }): string[] {
  throw new Error("TODO(task 10)");
}
export const MATHLIB_CACHE_ARGS: string[] = ["exe", "cache", "get"];
export function newLeanFileContent(_fileName: string): string {
  throw new Error("TODO(task 10)");
}
export function uniqueFileName(_base: string, _ext: string, _exists: (name: string) => boolean): string {
  throw new Error("TODO(task 10)");
}
export interface StarterLeanFile {
  /** Relative to the project root, "/" separators. */
  path: string;
  /** Lean module name, e.g. "Demo.Starter". */
  module: string;
  content: string;
  /** Unqualified theorem name inside namespace <lib>. */
  theoremName: string;
}
export function starterLeanFile(_libName: string): StarterLeanFile {
  throw new Error("TODO(task 10)");
}
export function blueprintFiles(_o: { projectName: string; libName: string; title?: string }): TemplateFile[] {
  throw new Error("TODO(task 10)");
}
```

Types used:
```ts
export interface TemplateFile {
  /** Path relative to the project root, with "/" separators. */
  path: string;
  content: string;
}
```

## Behaviour
**sanitizeProjectName(name)** — trim; replace every run of characters other than letters, digits, `_`, `-` by a single `_`; strip leading/trailing `_`; `""` when nothing remains. (`"  My Proof Project "` → `My_Proof_Project`, `"a/b\\c:d"` → `a_b_c_d`.)
**libNameFor(projectName)** — lake's convention: split on `_` and `-`, capitalise the first letter of each part (rest unchanged), join: `my_proof` → `MyProof`, `graph-theory` → `GraphTheory`, `Algebra` → `Algebra`. The result must be a valid Lean identifier: if it would start with a digit, prefix `Project` (`42things` → `Project42things`). Empty input → `"Project"`.
**lakeNewArgs({name, mathlib})** — `["new", name]`; with Mathlib: `["+leanprover-community/mathlib4:lean-toolchain", "new", name, "math"]`.
**MATHLIB_CACHE_ARGS** — already defined (`["exe","cache","get"]`); keep.
**newLeanFileContent(fileName)** — `"/-!\n# <title>\n\n-/\n"` where title = fileName without the `.lean` extension.
**uniqueFileName(base, ext, exists)** — `base.ext` if free, else `base 2.ext`, `base 3.ext`, … (a SPACE then the number).
**starterLeanFile(libName)** — `{ path: "<lib>/Starter.lean", module: "<lib>.Starter", theoremName: "starter_add_zero", content }` where content is:
```
namespace <lib>

/-- Starter theorem linked to the blueprint lemma `lem:starter`. Replace `sorry` with a proof. -/
theorem starter_add_zero (n : Nat) : n + 0 = n := by
  sorry

end <lib>
```
(No Mathlib imports; it must compile in a plain Lean project.)
**blueprintFiles({projectName, libName, title})** — `title` defaults to `<projectName> blueprint`; LaTeX-escape it where it is inserted (`& % $ # _ { }` → backslash-escaped; `~`→`\textasciitilde{}`; `^`→`\textasciicircum{}`; `\`→`\textbackslash{}`). Return exactly these six files (paths with `/`), contents as below.

`blueprint/src/print.tex` (the `\documentclass` MUST be the first line and have nothing after it on that line — TeXPane injects definitions there):
```
\documentclass[a4paper]{report}
\input{macros/common}
\input{macros/print}

\title{<escaped title>}
\author{}

\begin{document}
\maketitle
\tableofcontents
\input{content}
\end{document}
```
`blueprint/src/web.tex` — same shape for leanblueprint's web build:
```
\documentclass{report}
\input{macros/common}
\input{macros/web}

\title{<escaped title>}
\author{}

\begin{document}
\maketitle
\input{content}
\end{document}
```
`blueprint/src/macros/common.tex`:
```
\usepackage{amssymb, amsmath, amsthm, mathtools}
\usepackage[colorlinks=true, allcolors=blue]{hyperref}

\theoremstyle{plain}
\newtheorem{theorem}{Theorem}[chapter]
\newtheorem{proposition}[theorem]{Proposition}
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{corollary}[theorem]{Corollary}

\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
```
`blueprint/src/macros/print.tex` — the blueprint macros as no-ops, each with `\providecommand` (NOT `\newcommand`; TeXPane may already have defined them):
```
% Blueprint macros are only meaningful for the web build; in the printed PDF they do nothing.
\providecommand{\lean}[1]{}
\providecommand{\leanok}{}
\providecommand{\uses}[1]{}
\providecommand{\mathlibok}{}
\providecommand{\notready}{}
\providecommand{\proves}[1]{}
\providecommand{\discussion}[1]{}
```
`blueprint/src/macros/web.tex`:
```
% Used by leanblueprint's web build (plasTeX). Fill in the URLs of your repository.
\usepackage[showmore, dep_graph]{blueprint}
% \home{https://github.com/<user>/<repo>}
% \github{https://github.com/<user>/<repo>}
% \dochome{https://<user>.github.io/<repo>/docs}
```
`blueprint/src/content.tex`:
```
\chapter{Introduction}

\begin{lemma}[Adding zero]
  \label{lem:starter}
  \lean{<lib>.starter_add_zero}
  For every natural number $n$ we have $n + 0 = n$.
\end{lemma}

\begin{proof}
  By the definition of addition.
\end{proof}
```
(No `\leanok` — the Lean proof is still `sorry`.) No template placeholder syntax (double-brace pairs from a templating language, a dollar-brace sequence, the word `undefined`) may remain in any output.

## Tests
`test/unit/templates.test.ts` — includes a real `pdflatex` compile of `print.tex` (skipped when pdflatex is missing). Definition of done.
