import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverModules, ensureQueryFile, moduleToFile, parseQueryOutput, recordToStatus, runStatusQuery, scanModules } from "../../src/core/statusQuery";
import { STATUS_QUERY_LEAN } from "../../src/core/statusQuery.lean";

describe("parseQueryOutput", () => {
  it("parses JSON lines and ignores everything else (Lean warnings leak onto stdout)", () => {
    const out = [
      "/tmp/q.lean:74:8: warning: unused variable `ctx`",
      "",
      "Note: This linter can be disabled with `set_option linter.unusedVariables false`",
      '{"exists":false,"name":"A.nope"}',
      '{"anySorry":true,"exists":true,"kind":"theorem","line":18,"module":"StatusProj.Basic","name":"StatusProj.uses_sorry","ownSorry":false,"type":"∀ (n : Nat), n = n"}',
      "{not json",
    ].join("\n");
    const recs = parseQueryOutput(out);
    expect(recs.map((r) => r.name)).toEqual(["A.nope", "StatusProj.uses_sorry"]);
    expect(recs[1]).toMatchObject({ exists: true, kind: "theorem", line: 18, anySorry: true, ownSorry: false });
  });
  it("handles CRLF and empty output", () => {
    expect(parseQueryOutput('{"name":"a","exists":false}\r\n')).toEqual([{ name: "a", exists: false }]);
    expect(parseQueryOutput("")).toEqual([]);
  });
});

describe("recordToStatus mapping", () => {
  const now = 1234;
  const base = { name: "X.y", exists: true, module: "Proj.Mod", line: 7, kind: "theorem", type: "True", ownSorry: false, anySorry: false };
  it("not found => missing", () => {
    expect(recordToStatus({ name: "X.y", exists: false }, now)).toEqual({ name: "X.y", state: "missing", source: "build", updatedAt: now });
  });
  it("own sorry => stated (even though anySorry is also true)", () => {
    expect(recordToStatus({ ...base, ownSorry: true, anySorry: true }, now).state).toBe("stated");
  });
  it("transitive sorry only => proved-with-sorry-deps", () => {
    expect(recordToStatus({ ...base, anySorry: true }, now).state).toBe("proved-with-sorry-deps");
  });
  it("module under Mathlib => mathlib; plain => proved", () => {
    expect(recordToStatus({ ...base, module: "Mathlib.Data.Nat.Basic" }, now).state).toBe("mathlib");
    expect(recordToStatus({ ...base, module: "Mathlib" }, now).state).toBe("mathlib");
    expect(recordToStatus({ ...base, module: "MathlibExtras.Foo" }, now).state).toBe("proved");
    expect(recordToStatus(base, now).state).toBe("proved");
  });
  it("copies kind, line, signature (type) and maps the module to a file when a resolver is given", () => {
    const s = recordToStatus(base, now, () => "/abs/Proj/Mod.lean");
    expect(s).toEqual({ name: "X.y", state: "proved", kind: "theorem", line: 7, signature: "True", file: "/abs/Proj/Mod.lean", source: "build", updatedAt: now });
  });
  it("a record carrying `error` => unknown", () => {
    expect(recordToStatus({ name: "X.y", exists: true, error: "boom" }, now).state).toBe("unknown");
  });
  it("line null is omitted", () => {
    expect(recordToStatus({ ...base, line: null }, now).line).toBeUndefined();
  });
});

describe("discoverModules / moduleToFile / ensureQueryFile", () => {
  function tmpProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lp-sq-"));
    const w = (rel: string, text = "") => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    w("lakefile.toml");
    w("Proj.lean");
    w("Proj/Basic.lean");
    w("Proj/Broken.lean");
    w("Proj/Deep/X.lean");
    w("Main.lean");
    w("lakefile.lean");
    w(".lake/build/lib/lean/Proj.olean");
    w(".lake/build/lib/lean/Proj/Basic.olean");
    w(".lake/build/lib/lean/Proj/Deep/X.olean");
    w(".lake/packages/dep/Dep/Core.lean");
    w(".lake/packages/dep/.lake/build/lib/lean/Dep/Core.olean");
    return root;
  }
  it("lists project modules that have a built .olean (so a broken module does not break the query)", async () => {
    const root = tmpProject();
    expect(await discoverModules(root)).toEqual(["Proj", "Proj.Basic", "Proj.Deep.X"]);
  });
  it("returns [] for a project that was never built", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lp-sq-"));
    fs.writeFileSync(path.join(root, "A.lean"), "");
    expect(await discoverModules(root)).toEqual([]);
  });
  it("moduleToFile checks the project, then .lake/packages/*, else undefined", () => {
    const root = tmpProject();
    expect(moduleToFile(root, "Proj.Deep.X")).toBe(path.join(root, "Proj", "Deep", "X.lean"));
    expect(moduleToFile(root, "Dep.Core")).toBe(path.join(root, ".lake", "packages", "dep", "Dep", "Core.lean"));
    expect(moduleToFile(root, "Init.Data.Nat.Basic")).toBeUndefined();
  });
  it("ensureQueryFile writes the Lean program once into the temp dir and is idempotent", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lp-q-"));
    const f1 = await ensureQueryFile(dir);
    const f2 = await ensureQueryFile(dir);
    expect(f1).toBe(f2);
    expect(path.dirname(f1)).toBe(dir);
    expect(f1.endsWith(".lean")).toBe(true);
    expect(fs.readFileSync(f1, "utf8")).toBe(STATUS_QUERY_LEAN);
  });
});

describe("unbuilt sources never make a name `missing`", () => {
  function proj(files: Record<string, number | null>) {
    // value: mtime in seconds for sources and oleans (null = absent)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lp-stale-"));
    for (const [rel, t] of Object.entries(files)) {
      if (t === null) continue;
      const f = path.join(root, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, "");
      fs.utimesSync(f, t, t);
    }
    return root;
  }
  const exec = async () => ({ stdout: '{"name":"P.gone","exists":false}\n{"name":"P.here","exists":true,"module":"P","line":1,"kind":"theorem","ownSorry":false,"anySorry":false}\n', stderr: "", code: 0 });
  const run = (root: string) => runStatusQuery({ projectRoot: root, lakePath: "lake", env: {}, names: ["P.gone", "P.here"], exec, tmpDir: root });

  it("scanModules: stale when a source has no olean or is newer than it; Main.lean is ignored", async () => {
    expect((await scanModules(proj({ "P.lean": 10, ".lake/build/lib/lean/P.olean": 20, "Main.lean": 5 }))).stale).toBe(false);
    expect((await scanModules(proj({ "P.lean": 10, ".lake/build/lib/lean/P.olean": 20, "P/New.lean": 30 }))).stale).toBe(true);
    expect((await scanModules(proj({ "P.lean": 30, ".lake/build/lib/lean/P.olean": 20 }))).stale).toBe(true);
  });
  it("up-to-date project: a name that is not found is `missing`", async () => {
    const res = await run(proj({ "P.lean": 10, ".lake/build/lib/lean/P.olean": 20 }));
    expect(res["P.gone"].state).toBe("missing");
    expect(res["P.here"].state).toBe("proved");
  });
  it("unbuilt module, or a stub appended after the build: not found => unknown (source none), found names still answered", async () => {
    for (const files of <Array<Record<string, number>>>[
      { "P.lean": 10, ".lake/build/lib/lean/P.olean": 20, "P/Unbuilt.lean": 5 },
      { "P.lean": 30, ".lake/build/lib/lean/P.olean": 20 },
    ]) {
      const res = await run(proj(files));
      expect(res["P.gone"]).toMatchObject({ state: "unknown", source: "none" });
      expect(res["P.here"].state).toBe("proved");
    }
  });
});
