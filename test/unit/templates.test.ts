import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { blueprintFiles, libNameFor, lakeNewArgs, MATHLIB_CACHE_ARGS, newLeanFileContent, sanitizeProjectName, starterLeanFile, uniqueFileName } from "../../src/core/templates";

describe("project naming", () => {
  it("sanitizeProjectName trims and replaces spaces/odd characters; empty on nothing usable", () => {
    expect(sanitizeProjectName("  My Proof Project ")).toBe("My_Proof_Project");
    expect(sanitizeProjectName("a/b\\c:d")).toBe("a_b_c_d");
    expect(sanitizeProjectName("ok-name_1")).toBe("ok-name_1");
    expect(sanitizeProjectName("   ")).toBe("");
    expect(sanitizeProjectName("")).toBe("");
  });
  it("libNameFor follows lake's convention (CamelCase library from the package name)", () => {
    expect(libNameFor("my_proof")).toBe("MyProof");
    expect(libNameFor("status_proj")).toBe("StatusProj");
    expect(libNameFor("graph-theory")).toBe("GraphTheory");
    expect(libNameFor("Algebra")).toBe("Algebra");
    expect(libNameFor("42things")).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/); // always a valid Lean identifier
  });
});

describe("lake commands", () => {
  it("plain project", () => {
    expect(lakeNewArgs({ name: "demo", mathlib: false })).toEqual(["new", "demo"]);
  });
  it("Mathlib project uses the mathlib toolchain and the math template", () => {
    expect(lakeNewArgs({ name: "demo", mathlib: true })).toEqual(["+leanprover-community/mathlib4:lean-toolchain", "new", "demo", "math"]);
    expect(MATHLIB_CACHE_ARGS).toEqual(["exe", "cache", "get"]);
  });
});

describe("new Lean file", () => {
  it("has a module docstring and the title", () => {
    const c = newLeanFileContent("Untitled.lean");
    expect(c).toBe("/-!\n# Untitled\n\n-/\n");
    expect(newLeanFileContent("My Notes.lean")).toBe("/-!\n# My Notes\n\n-/\n");
  });
  it("uniqueFileName counts up", () => {
    const taken = new Set(["Untitled.lean", "Untitled 2.lean"]);
    expect(uniqueFileName("Untitled", "lean", (n) => taken.has(n))).toBe("Untitled 3.lean");
    expect(uniqueFileName("Untitled", "lean", () => false)).toBe("Untitled.lean");
  });
});

describe("blueprint skeleton", () => {
  const files = blueprintFiles({ projectName: "demo", libName: "Demo", title: "Demo blueprint" });
  const get = (p: string) => files.find((f) => f.path === p)?.content;

  it("contains the standard leanblueprint layout", () => {
    expect(files.map((f) => f.path).sort()).toEqual([
      "blueprint/src/content.tex",
      "blueprint/src/macros/common.tex",
      "blueprint/src/macros/print.tex",
      "blueprint/src/macros/web.tex",
      "blueprint/src/print.tex",
      "blueprint/src/web.tex",
    ]);
  });
  it("print.tex and web.tex input the macros and content; macros/print.tex defines every blueprint macro with \\providecommand", () => {
    expect(get("blueprint/src/print.tex")).toMatch(/\\input\{macros\/common\}/);
    expect(get("blueprint/src/print.tex")).toMatch(/\\input\{macros\/print\}/);
    expect(get("blueprint/src/print.tex")).toMatch(/\\input\{content\}/);
    expect(get("blueprint/src/web.tex")).toMatch(/\\input\{macros\/web\}/);
    expect(get("blueprint/src/web.tex")).toMatch(/\\input\{content\}/);
    const pm = get("blueprint/src/macros/print.tex")!;
    for (const m of ["lean", "leanok", "uses", "mathlibok", "notready", "proves", "discussion"]) expect(pm, m).toMatch(new RegExp(`\\\\providecommand\\{\\\\${m}\\}`));
    expect(pm).not.toMatch(/\\newcommand\{\\(lean|leanok|uses|mathlibok|notready|proves|discussion)\}/);
  });
  it("macros/common.tex declares the theorem-like environments leanblueprint uses", () => {
    const c = get("blueprint/src/macros/common.tex")!;
    for (const env of ["theorem", "lemma", "proposition", "corollary", "definition"]) expect(c, env).toMatch(new RegExp(`\\\\newtheorem\\{${env}\\}`));
    expect(c).toMatch(/amsthm/);
  });
  it("content.tex has a starter lemma tied to a Lean theorem that has sorry (so no \\leanok yet)", () => {
    const c = get("blueprint/src/content.tex")!;
    const starter = starterLeanFile("Demo");
    expect(c).toMatch(/\\begin\{lemma\}/);
    expect(c).toMatch(/\\label\{lem:[a-z_]+\}/);
    expect(c).toContain(`\\lean{Demo.${starter.theoremName}}`);
    expect(c).toMatch(/\\begin\{proof\}/);
    expect(c).not.toMatch(/\\leanok/);
  });
  it("starter Lean file: namespaced theorem with sorry, in <Lib>/Starter.lean", () => {
    const s = starterLeanFile("Demo");
    expect(s.path).toBe("Demo/Starter.lean");
    expect(s.module).toBe("Demo.Starter");
    expect(s.content).toContain("namespace Demo");
    expect(s.content).toContain(`theorem ${s.theoremName}`);
    expect(s.content).toContain("sorry");
    expect(s.content).not.toMatch(/Mathlib/); // must work without Mathlib
  });
  it("uses the project title in both entry points and never leaves template placeholders behind", () => {
    expect(get("blueprint/src/print.tex")).toContain("Demo blueprint");
    for (const f of files) expect(f.content, f.path).not.toMatch(/\{\{|\}\}|undefined|\$\{/);
  });
  it("LaTeX special characters in the title are escaped", () => {
    const f = blueprintFiles({ projectName: "x", libName: "X", title: "A & B_c 50%" });
    expect(f.find((x) => x.path === "blueprint/src/print.tex")!.content).toContain("A \\& B\\_c 50\\%");
  });

  const hasPdflatex = spawnSync("pdflatex", ["--version"]).status === 0;
  it.skipIf(!hasPdflatex)("print.tex compiles with pdfLaTeX, also when the macros are pre-defined by TeXPane's shadow build", () => {
    for (const shadow of [false, true]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lp-bp-"));
      for (const f of files) {
        fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
        fs.writeFileSync(path.join(dir, f.path), f.content);
      }
      const src = path.join(dir, "blueprint", "src");
      if (shadow) {
        const p = path.join(src, "print.tex");
        const t = fs.readFileSync(p, "utf8").replace(
          /(\\documentclass[^\n]*)/,
          "$1\\providecommand{\\lean}[1]{}\\providecommand{\\leanok}{}\\providecommand{\\uses}[1]{}\\providecommand{\\mathlibok}{}\\providecommand{\\notready}{}\\providecommand{\\proves}[1]{}\\providecommand{\\discussion}[1]{}",
        );
        fs.writeFileSync(p, t);
      }
      const r = spawnSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "print.tex"], { cwd: src, encoding: "utf8", timeout: 120000 });
      expect(r.status, `shadow=${shadow}\n${r.stdout}`).toBe(0);
      expect(fs.existsSync(path.join(src, "print.pdf"))).toBe(true);
    }
  });
});
