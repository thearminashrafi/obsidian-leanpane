# Task 06 — Plain goal parser/formatter (`src/core/goals.ts`)

> You are a careful junior engineer. This file is self-contained: read it fully, then read ONLY the files it names.
> Do not read other files in the repo and do not change anything outside the files listed under "Files you may edit".

## Ground rules (all tasks)
- Repo: `/home/claude/leanpane-build/obsidian-leanpane` (Node 22, TypeScript 5.5 strict, ES modules, vitest 2). Do NOT run `git commit`/`git add`; the lead commits.
- Edit ONLY the files listed under "Files you may edit". Never edit tests, `src/types.ts`, `docs/`, or another task's file. If a test looks wrong or the spec contradicts it, do not "fix" the test: implement the most reasonable behaviour, and describe the problem in your final report.
- `src/core/*` must NOT import `obsidian` or anything from the browser/DOM. Use Node built-ins with the `node:` prefix (`node:path`, `node:fs/promises`, ...). Use `node:path` functions (never hard-coded `/` or `\\` separators) unless the task says otherwise; code must work on macOS, Linux and Windows.
- Keep the exported names and signatures from the contract below EXACTLY (the lead's integration code and the tests import them). You may add extra exports and private helpers inside your file.
- Replace each `throw new Error("TODO(task 06)")` stub with a real implementation. No `any` unless the contract already has it. No `console.log` in library code.
- Style: 2-space indent, double quotes, semicolons, trailing commas, width ~140. Short comments only where the logic is not obvious.
- Other workers edit other files at the same time. `npx tsc --noEmit` may show errors in files you do not own: ignore them; make sure none are in your file (`npx tsc --noEmit 2>&1 | grep <yourfile>`).

## Test command
```
cd /home/claude/leanpane-build/obsidian-leanpane && npx vitest run --project tasks test/unit/goals.test.ts
```
Run it repeatedly while you work. The task is done when every test in the named file(s) passes (or is skipped by its own `skipIf` for a missing tool) and `tsc` shows no errors in your file.

## Final report (your last message)
Keep it short: files changed; test results (passed/failed/skipped counts); any test you believe is wrong or any ambiguity in this spec, with your reasoning; anything the lead must know for integration.

## Purpose
The goals pane has an interactive mode (a web view) and a plain fallback. The fallback asks Lean for `$/lean/plainGoal` / `$/lean/plainTermGoal`, which return goals as plain text, and renders them nicely: hypotheses table, `⊢` target, one block per goal, case labels. This module parses that text into structured data and formats it back. Pure functions.

## Files you may edit
- `src/core/goals.ts` (stub). May read `src/types.ts`, `test/unit/goals.test.ts`, and the real sample `test/fixtures/lsp/goals.plainGoals.json`.

## Contract (current content of the stub — keep these signatures)
```ts
/**
 * Parsing/formatting of Lean's plain-text goals ($/lean/plainGoal, $/lean/plainTermGoal). Pure. TASK: docs/tasks/06-goals.md
 */
import type { PlainGoal } from "../types";

export function parseGoal(_text: string): PlainGoal {
  throw new Error("TODO(task 06)");
}

/** `null`/empty => []. */
export function parsePlainGoalResponse(_resp: { goals: string[]; rendered?: string } | null | undefined): PlainGoal[] {
  throw new Error("TODO(task 06)");
}

/** Response of $/lean/plainTermGoal ({ goal, range }) as a goal; null stays null. */
export function parsePlainTermGoal(_resp: { goal: string; range?: unknown } | null | undefined): PlainGoal | null {
  throw new Error("TODO(task 06)");
}

/** The text Lean would print: goals separated by a blank line. */
export function formatGoalsText(_goals: PlainGoal[]): string {
  throw new Error("TODO(task 06)");
}

export function goalCountLabel(_n: number): string {
  throw new Error("TODO(task 06)");
}
```

Types used (from `src/types.ts`):
```ts
export interface GoalHyp {
  /** Names that share this type: `a b : Nat` -> ["a","b"]. */
  names: string[];
  type: string;
  /** For let-bound hypotheses `x : Nat := 5` the value text, else undefined. */
  value?: string;
}

export interface PlainGoal {
  /** `case zero` -> "zero". */
  caseName?: string;
  hyps: GoalHyp[];
  /** Text after `⊢ ` (may span lines). */
  target: string;
}
```

## Format of one goal string (what Lean prints)
```
case zero                 <- optional first line "case <tag>" (tag may contain dots: h.left)
b c : Nat                 <- hypotheses: "<names separated by spaces> : <type>"
h : ∀ x,                  <- a long type continues on following lines that are INDENTED (start with whitespace)
    f x x = x
x : Nat := 5              <- let-bound: "<names> : <type> := <value>"
⊢ b + c = c + b           <- the target starts with "⊢ "; continuation lines are indented
```
Several goals arrive as separate strings in `goals: string[]` (the `rendered` field is markdown; ignore it). Names can contain `✝`, `'`, digits, dots, unicode (`α✝`, `inst✝`, `h.1`).

## Behaviour
**parseGoal(text)** — normalise `\r\n` to `\n`, trim trailing whitespace/newlines. Walk the lines:
- first line `case <tag>` → `caseName` (only if it is the very first line);
- a line that starts with `⊢` → begins the target (text after `⊢ `, i.e. after the symbol and one space); following lines that start with whitespace are appended with `\n` and their original indentation kept; everything after the target belongs to it;
- a line that does NOT start with whitespace and is not `⊢…` begins a hypothesis: split at the FIRST occurrence of ` : ` (space colon space); the left part split on whitespace → `names`; the right part is the type; following lines that start with whitespace are appended (`\n` + the line as is);
- if a hypothesis type contains ` := ` at bracket depth 0 (depth of `()[]{}⟨⟩`), split the FIRST such occurrence: `type` before, `value` after (omit `value` when absent — the property must not exist, tests use `toEqual`);
- `caseName` is omitted (not `undefined`-valued key… `toEqual` ignores undefined keys, but keep it clean) when there is none; `hyps` is `[]` when there are none; `target` is `""` if no `⊢` line exists.
- A hypothesis type containing ` : ` deeper inside (e.g. `∀ (x : Nat), x = x`) must NOT be split again.

**parsePlainGoalResponse(resp)** — null/undefined/empty `goals` → `[]`; else `goals.map(parseGoal)`.
**parsePlainTermGoal(resp)** — null → null; else `parseGoal(resp.goal)`.
**formatGoalsText(goals)** — reproduces what Lean would print: optional `case <tag>` line, hypotheses (`names.join(" ") + " : " + type`, plus ` := value`), `⊢ target`; goals separated by one blank line; `[]` → `""`. `formatGoalsText([parseGoal(t)]) === t` must hold for the well-formed examples in the tests.
**goalCountLabel(n)** — `"No goals"`, `"1 goal"`, `"N goals"`.

## Tests
`test/unit/goals.test.ts`. Definition of done.
