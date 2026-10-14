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
