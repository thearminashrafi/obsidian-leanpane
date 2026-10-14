/**
 * Parsing/formatting of Lean's plain-text goals ($/lean/plainGoal, $/lean/plainTermGoal). Pure. TASK: docs/tasks/06-goals.md
 */
import type { GoalHyp, PlainGoal } from "../types";

const TURNSTILE = "⊢";

/** Index of the first " := " that sits at bracket depth 0, or -1. */
function findTopLevelAssign(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ("([{⟨".includes(c)) depth++;
    else if (")]}⟩".includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(" := ", i)) return i;
  }
  return -1;
}

/** Parses one hypothesis entry (header line plus indented continuation lines). */
function parseHyp(lines: string[]): GoalHyp {
  const header = lines[0];
  const sep = header.indexOf(" : ");
  let names: string[];
  let type: string;
  if (sep === -1) {
    names = [];
    type = lines.join("\n");
  } else {
    names = header.slice(0, sep).split(/\s+/).filter((s) => s.length > 0);
    type = [header.slice(sep + 3), ...lines.slice(1)].join("\n");
  }
  const assign = findTopLevelAssign(type);
  if (assign === -1) return { names, type };
  return { names, type: type.slice(0, assign), value: type.slice(assign + 4) };
}

export function parseGoal(text: string): PlainGoal {
  const lines = text.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const goal: PlainGoal = { hyps: [], target: "" };

  let i = 0;
  const caseMatch = /^case (\S+)$/.exec(lines[0] ?? "");
  if (caseMatch) {
    goal.caseName = caseMatch[1];
    i = 1;
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith(TURNSTILE)) {
      let first = line.slice(TURNSTILE.length);
      if (first.startsWith(" ")) first = first.slice(1);
      goal.target = [first, ...lines.slice(i + 1)].join("\n");
      break;
    }
    if (/^\s/.test(line)) {
      // Indented line with no entry before it: nothing to attach to.
      i++;
      continue;
    }
    const entry = [line];
    i++;
    while (i < lines.length && /^\s/.test(lines[i])) {
      entry.push(lines[i]);
      i++;
    }
    goal.hyps.push(parseHyp(entry));
  }
  return goal;
}

/** `null`/empty => []. */
export function parsePlainGoalResponse(resp: { goals: string[]; rendered?: string } | null | undefined): PlainGoal[] {
  if (!resp || !resp.goals || resp.goals.length === 0) return [];
  return resp.goals.map(parseGoal);
}

/** Response of $/lean/plainTermGoal ({ goal, range }) as a goal; null stays null. */
export function parsePlainTermGoal(resp: { goal: string; range?: unknown } | null | undefined): PlainGoal | null {
  if (!resp) return null;
  return parseGoal(resp.goal);
}

/** The text Lean would print: goals separated by a blank line. */
export function formatGoalsText(goals: PlainGoal[]): string {
  return goals
    .map((g) => {
      const out: string[] = [];
      if (g.caseName !== undefined) out.push(`case ${g.caseName}`);
      for (const h of g.hyps) {
        out.push(`${h.names.join(" ")} : ${h.type}${h.value !== undefined ? ` := ${h.value}` : ""}`);
      }
      out.push(`${TURNSTILE} ${g.target}`);
      return out.join("\n");
    })
    .join("\n\n");
}

export function goalCountLabel(n: number): string {
  if (n === 0) return "No goals";
  if (n === 1) return "1 goal";
  return `${n} goals`;
}
