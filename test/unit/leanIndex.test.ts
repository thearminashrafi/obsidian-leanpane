import { describe, expect, it } from "vitest";
import { buildLeanIndex } from "../../src/core/leanIndex";

describe("buildLeanIndex", () => {
  it("finds projects by lakefile and assigns files to the deepest project", () => {
    const idx = buildLeanIndex([
      "Lean/Proj/lakefile.toml",
      "Lean/Proj/Proj.lean",
      "Lean/Proj/Proj/Basic.lean",
      "Lean/Proj/lean-toolchain",
      "Lean/Proj/sub/lakefile.lean",
      "Lean/Proj/sub/A.lean",
      "Lean/a.lean",
      "notes.md",
    ]);
    expect(idx.projects.map((p) => p.root)).toEqual(["Lean/Proj", "Lean/Proj/sub"]);
    expect(idx.projects[0].files).toEqual(["Lean/Proj/Proj.lean", "Lean/Proj/Proj/Basic.lean"]);
    expect(idx.projects[1].files).toEqual(["Lean/Proj/sub/A.lean", "Lean/Proj/sub/lakefile.lean"]);
    expect(idx.loose).toEqual(["Lean/a.lean"]);
  });
  it("ignores hidden folders such as .lake", () => {
    const idx = buildLeanIndex(["P/lakefile.toml", "P/.lake/packages/x/lakefile.lean", "P/.lake/packages/x/X.lean"]);
    expect(idx.projects.map((p) => p.root)).toEqual(["P"]);
    expect(idx.projects[0].files).toEqual([]);
  });
  it("handles a project at the vault root", () => {
    const idx = buildLeanIndex(["lakefile.lean", "Main.lean", "x/Y.lean"]);
    expect(idx.projects[0].root).toBe("");
    expect(idx.projects[0].files).toEqual(["lakefile.lean", "Main.lean", "x/Y.lean"]);
    expect(idx.loose).toEqual([]);
  });
  it("prefers lakefile.toml when both exist", () => {
    expect(buildLeanIndex(["P/lakefile.lean", "P/lakefile.toml"]).projects[0].lakefile).toBe("lakefile.toml");
  });
});
