import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { formatGoalsText, goalCountLabel, parseGoal, parsePlainGoalResponse, parsePlainTermGoal } from "../../src/core/goals";

describe("parseGoal", () => {
  it("hypotheses, shared names, target", () => {
    expect(parseGoal("p q : Prop\nhp : p\nhq : q\n⊢ q ∧ p")).toEqual({
      hyps: [{ names: ["p", "q"], type: "Prop" }, { names: ["hp"], type: "p" }, { names: ["hq"], type: "q" }],
      target: "q ∧ p",
    });
  });
  it("case tag", () => {
    const g = parseGoal("case zero\nb c : Nat\n⊢ b + c = c + b");
    expect(g.caseName).toBe("zero");
    expect(g.hyps).toEqual([{ names: ["b", "c"], type: "Nat" }]);
    expect(g.target).toBe("b + c = c + b");
  });
  it("dotted case tags and no hypotheses", () => {
    expect(parseGoal("case h.left\n⊢ True")).toEqual({ caseName: "h.left", hyps: [], target: "True" });
    expect(parseGoal("⊢ 1 = 1")).toEqual({ hyps: [], target: "1 = 1" });
  });
  it("multi-line hypotheses and targets: indented continuation lines belong to the previous entry", () => {
    const g = parseGoal("f : Nat →\n  Nat →\n  Nat\nh : ∀ x,\n    f x x = x\n⊢ ∃ y,\n    f y y = y");
    expect(g.hyps).toEqual([{ names: ["f"], type: "Nat →\n  Nat →\n  Nat" }, { names: ["h"], type: "∀ x,\n    f x x = x" }]);
    expect(g.target).toBe("∃ y,\n    f y y = y");
  });
  it("let-bound hypotheses keep the value separately", () => {
    expect(parseGoal("x : Nat := 5\n⊢ x = 5").hyps).toEqual([{ names: ["x"], type: "Nat", value: "5" }]);
  });
  it("inaccessible names and instance hypotheses", () => {
    const g = parseGoal("α✝ : Type\ninst✝ : Inhabited α✝\na✝ b✝ : α✝\n⊢ a✝ = b✝");
    expect(g.hyps.map((h) => h.names)).toEqual([["α✝"], ["inst✝"], ["a✝", "b✝"]]);
  });
  it("a type containing ' : ' or ':=' deeper inside is not split twice", () => {
    expect(parseGoal("h : ∀ (x : Nat), x = x\n⊢ True").hyps).toEqual([{ names: ["h"], type: "∀ (x : Nat), x = x" }]);
  });
  it("Windows line endings and trailing whitespace", () => {
    expect(parseGoal("n : Nat\r\n⊢ n = n\r\n").target).toBe("n = n");
  });
});

describe("parsePlainGoalResponse", () => {
  it("null / empty => no goals", () => {
    expect(parsePlainGoalResponse(null)).toEqual([]);
    expect(parsePlainGoalResponse({ goals: [], rendered: "" })).toEqual([]);
  });
  it("real Lean output (captured)", () => {
    const real = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "fixtures", "lsp", "goals.plainGoals.json"), "utf8"));
    const goals = parsePlainGoalResponse(real.bullet_first.plainGoal);
    expect(goals.length).toBe(1);
    expect(goals[0].caseName).toBe("left");
    expect(goals[0].target).toBe("q");
    expect(goals[0].hyps.map((h) => h.names.join(" "))).toEqual(["p q", "hp", "hq"]);
  });
  it("several goals", () => {
    const g = parsePlainGoalResponse({ goals: ["case a\n⊢ P", "case b\nn : Nat\n⊢ Q n"] });
    expect(g.map((x) => x.caseName)).toEqual(["a", "b"]);
  });
});

describe("parsePlainTermGoal", () => {
  it("returns the expected type as a goal; null stays null", () => {
    expect(parsePlainTermGoal(null)).toBeNull();
    const r = parsePlainTermGoal({ goal: "n : Nat\n⊢ n + 0 = n", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } });
    expect(r?.target).toBe("n + 0 = n");
    expect(r?.hyps[0].names).toEqual(["n"]);
  });
});

describe("formatGoalsText / goalCountLabel", () => {
  it("round-trips a goal to the text Lean would show; goals are separated by a blank line", () => {
    const text = "case zero\nb c : Nat\n⊢ b + c = c + b";
    expect(formatGoalsText([parseGoal(text)])).toBe(text);
    expect(formatGoalsText([parseGoal("⊢ A"), parseGoal("⊢ B")])).toBe("⊢ A\n\n⊢ B");
    expect(formatGoalsText([])).toBe("");
  });
  it("labels", () => {
    expect([0, 1, 2].map(goalCountLabel)).toEqual(["No goals", "1 goal", "2 goals"]);
  });
});
