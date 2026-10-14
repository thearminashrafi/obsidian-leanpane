import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { createLeanPaneApi, resolveStubFile, type ProviderDeps } from "../../src/integration/provider";
import { StatusEngine } from "../../src/core/statusEngine";
import { API_VERSION } from "../../src/integration/api-types";
import type { DeclStatus, ProjectDescriptor } from "../../src/types";

const VAULT = path.resolve("/vaults/main");
const ROOT = path.join(VAULT, "Proj");
const project: ProjectDescriptor = { root: ROOT, lakefile: "lakefile.toml", toolchain: "leanprover/lean4:v4.25.1", usesMathlib: false };

function setup(over: Partial<ProviderDeps> = {}) {
  const files = new Map<string, string>();
  const opened: any[] = [];
  const queries: string[][] = [];
  const engine = new StatusEngine({
    runStatus: async (_r, names) => {
      queries.push(names);
      const out: Record<string, DeclStatus> = {};
      for (const n of names) {
        out[n] =
          n === "Proj.ok" ? { name: n, state: "proved", file: path.join(ROOT, "Proj", "A.lean"), line: 7, kind: "theorem", signature: "1 = 1", source: "build", updatedAt: 1 }
          : n === "Mathlib.thing" ? { name: n, state: "mathlib", file: path.join(ROOT, ".lake", "packages", "mathlib", "M.lean"), line: 3, source: "build", updatedAt: 1 }
          : { name: n, state: "missing", source: "build", updatedAt: 1 };
      }
      return out;
    },
    runList: async () => [{ name: "Proj.ok", kind: "theorem", file: path.join(ROOT, "Proj", "A.lean"), line: 7 }],
  });
  const deps: ProviderDeps = {
    vaultBase: () => VAULT,
    findProject: async (dir) => (dir === ROOT || dir.startsWith(ROOT + path.sep) ? project : null),
    isDirectory: async (abs) => abs === ROOT || abs === path.join(ROOT, "blueprint"),
    engine,
    openLocation: async (abs, line, o) => (opened.push({ abs, line, ...o }), true),
    readFile: async (abs) => files.get(abs) ?? null,
    writeFile: async (abs, text) => void files.set(abs, text),
    ...over,
  };
  return { api: createLeanPaneApi(deps), files, opened, queries, engine };
}

describe("LeanPaneApiV1 provider", () => {
  it("has version 1", () => {
    expect(setup().api.version).toBe(API_VERSION);
  });

  it("projectForPath walks up from a file or a folder and stays inside the vault", async () => {
    const { api } = setup();
    expect(await api.projectForPath("Proj/blueprint/src/content.tex")).toEqual({ root: "Proj", absRoot: ROOT, toolchain: "leanprover/lean4:v4.25.1", usesMathlib: false });
    expect((await api.projectForPath("Proj/blueprint"))?.root).toBe("Proj");
    expect(await api.projectForPath("Notes/a.md")).toBeNull();
  });

  it("getStatus accepts vault-relative and absolute roots and returns vault-relative file paths", async () => {
    const { api, queries } = setup();
    const r1 = await api.getStatus("Proj", ["Proj.ok", "Proj.nope"]);
    expect(r1["Proj.ok"]).toMatchObject({ state: "proved", file: "Proj/Proj/A.lean", line: 7, signature: "1 = 1" });
    expect(r1["Proj.nope"].state).toBe("missing");
    const r2 = await api.getStatus(ROOT, ["Proj.ok"]);
    expect(r2["Proj.ok"].file).toBe("Proj/Proj/A.lean");
    expect(queries).toHaveLength(1); // second call served from the cache
    await api.getStatus("Proj", ["Proj.ok"], { refresh: true });
    expect(queries).toHaveLength(2);
  });

  it("keeps hidden (.lake) files as vault-relative too and non-vault files absolute", async () => {
    const { api } = setup();
    expect((await api.getStatus("Proj", ["Mathlib.thing"]))["Mathlib.thing"].file).toBe("Proj/.lake/packages/mathlib/M.lean");
  });

  it("listDeclarations maps file paths", async () => {
    const { api } = setup();
    expect(await api.listDeclarations("Proj", "Proj.")).toEqual([{ name: "Proj.ok", kind: "theorem", file: "Proj/Proj/A.lean", line: 7 }]);
  });

  it("openDeclaration opens the file at the declaration line, false when it cannot be located", async () => {
    const { api, opened } = setup();
    expect(await api.openDeclaration("Proj", "Proj.ok", { newLeaf: true })).toBe(true);
    expect(opened).toEqual([{ abs: path.join(ROOT, "Proj", "A.lean"), line: 7, newLeaf: true, projectRoot: ROOT }]);
    expect(await api.openDeclaration("Proj", "Proj.nope")).toBe(false);
  });

  it("createStub appends a sorry theorem to a new or existing file and reports its line", async () => {
    const { api, files } = setup();
    const a = await api.createStub("Proj", { file: "Proj/Proj/New.lean", name: "Proj.lem_bound", docstring: "Bound it." });
    expect(a).toEqual({ file: "Proj/Proj/New.lean", line: 1 });
    expect(files.get(path.join(ROOT, "Proj", "New.lean"))).toBe("/-- Bound it. -/\ntheorem Proj.lem_bound : sorry := by\n  sorry\n");
    files.set(path.join(ROOT, "B.lean"), "import Foo\n");
    const b = await api.createStub(ROOT, { file: "B.lean", name: "x", docstring: "" }); // project-relative
    expect(b).toEqual({ file: "Proj/B.lean", line: 3 });
    expect(files.get(path.join(ROOT, "B.lean"))).toBe("import Foo\n\ntheorem x : sorry := by\n  sorry\n");
  });

  it("createStub registers the stub as a live `stated` entry right away (the file need not be open or built)", async () => {
    const { api } = setup();
    await api.createStub("Proj", { file: "Proj/Proj/New.lean", name: "Proj.fresh", docstring: "d" });
    expect((await api.getStatus("Proj", ["Proj.fresh"]))["Proj.fresh"]).toMatchObject({ state: "stated", source: "live", file: "Proj/Proj/New.lean", line: 1 });
    expect((await api.listDeclarations("Proj")).find((d) => d.name === "Proj.fresh")).toMatchObject({ file: "Proj/Proj/New.lean", line: 1 });
  });

  it("createStub only writes .lean files inside the project (no other extension, outside paths, .. escapes, .lake, lakefile.lean)", async () => {
    const { api, files } = setup();
    const bad = ["Notes.md", "../Other/X.lean", path.join(VAULT, "Elsewhere", "X.lean"), "Proj/../../X.lean", ".lake/packages/dep/X.lean", "lakefile.lean", "X"];
    for (const file of bad) await expect(api.createStub(ROOT, { file, name: "x", docstring: "" }), file).rejects.toThrow(/Cannot create a stub/);
    expect(files.size).toBe(0);
  });

  it("createStub refuses existing names (in the file or the project) and invalid names", async () => {
    const { api, files } = setup();
    files.set(path.join(ROOT, "B.lean"), "theorem Proj.there : True := trivial\n");
    await expect(api.createStub(ROOT, { file: "B.lean", name: "Proj.there", docstring: "" })).rejects.toThrow(/already declared/);
    await expect(api.createStub(ROOT, { file: "C.lean", name: "Proj.ok", docstring: "" })).rejects.toThrow(/already exists in the project/);
    await expect(api.createStub(ROOT, { file: "C.lean", name: "a\ntheorem evil", docstring: "" })).rejects.toThrow(/not a valid Lean declaration name/);
    expect(files.has(path.join(ROOT, "C.lean"))).toBe(false);
  });

  it("createStub fails (and registers nothing) when the target is open read-only", async () => {
    const { api } = setup({ writeFile: async () => { throw new Error("open read-only"); } });
    await expect(api.createStub(ROOT, { file: "R.lean", name: "Proj.ro", docstring: "" })).rejects.toThrow(/read-only/);
    expect((await api.getStatus("Proj", ["Proj.ro"]))["Proj.ro"].state).toBe("missing");
  });

  it("an untrusted project answers unknown / empty from the background API without spawning", async () => {
    const queries: string[][] = [];
    const engine = new StatusEngine({ isTrusted: () => false, runStatus: async (_r, n) => (queries.push(n), {}), runList: async () => (queries.push(["list"]), [{ name: "x", kind: "", file: "", line: 0 }]) });
    const { api } = setup({ engine });
    expect((await api.getStatus("Proj", ["Proj.ok"]))["Proj.ok"]).toMatchObject({ state: "unknown", source: "none" });
    expect(await api.listDeclarations("Proj")).toEqual([]);
    expect(queries).toEqual([]);
  });

  it("onStatusChanged reports vault-relative roots and can be unsubscribed", async () => {
    const { api, engine } = setup();
    const seen: Array<[string, unknown]> = [];
    const off = api.onStatusChanged((root, names) => seen.push([root, names]));
    engine.setLive(ROOT, path.join(ROOT, "A.lean"), [{ name: "X.y", shortName: "y", symbolKind: 6, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, state: "stated" }]);
    expect(seen).toEqual([["Proj", ["X.y"]]]);
    off();
    engine.setLive(ROOT, path.join(ROOT, "A.lean"), null);
    expect(seen).toHaveLength(1);
  });
});

describe("resolveStubFile", () => {
  it("handles absolute, vault-relative and project-relative paths", () => {
    expect(resolveStubFile(path.join(ROOT, "X.lean"), VAULT, ROOT)).toBe(path.join(ROOT, "X.lean"));
    expect(resolveStubFile("Proj/X.lean", VAULT, ROOT)).toBe(path.join(ROOT, "X.lean"));
    expect(resolveStubFile("X.lean", VAULT, ROOT)).toBe(path.join(ROOT, "X.lean"));
    expect(resolveStubFile("Y.lean", VAULT, VAULT)).toBe(path.join(VAULT, "Y.lean")); // project at the vault root
  });
});
