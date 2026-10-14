import { beforeAll, expect, it } from "vitest";
import { discoverModules, runListQuery, runStatusQuery } from "../../src/core/statusQuery";
import { describeLean, ensureBuilt, leanTools, STATUS_PROJ } from "../helpers/lean";

describeLean("status query against the real fixture project (Lean 4.25.1)", () => {
  beforeAll(() => ensureBuilt());
  const common = () => ({ projectRoot: STATUS_PROJ, lakePath: leanTools!.lake, env: leanTools!.env });

  it("discovers exactly the built modules (Broken.lean and Symbols.lean are not built)", async () => {
    expect(await discoverModules(STATUS_PROJ)).toEqual(["StatusProj", "StatusProj.Basic", "StatusProj.Eval", "StatusProj.Goals"]);
  });

  it("classifies missing / stated / proved-with-sorry-deps / proved / unknown module-less names", async () => {
    const names = ["StatusProj.not_there", "StatusProj.stated_sorry", "StatusProj.uses_sorry", "StatusProj.proved_add_zero", "StatusProj.double", "Nat.add_comm", "StatusProj.broken_type"];
    const res = await runStatusQuery({ ...common(), names });
    // the fixture has unbuilt modules (Broken, Symbols): "not found" proves nothing there
    expect(res["StatusProj.not_there"]).toMatchObject({ state: "unknown", source: "none" });
    const upToDate = await runStatusQuery({ ...common(), names: ["StatusProj.not_there"], stale: false });
    expect(upToDate["StatusProj.not_there"].state).toBe("missing");
    expect(res["StatusProj.stated_sorry"]).toMatchObject({ state: "stated", kind: "theorem", line: 14, source: "build" });
    expect(res["StatusProj.uses_sorry"].state).toBe("proved-with-sorry-deps");
    expect(res["StatusProj.proved_add_zero"]).toMatchObject({ state: "proved", line: 10 });
    expect(res["StatusProj.proved_add_zero"].signature).toBe("∀ (n : Nat), n + 0 = n");
    expect(res["StatusProj.proved_add_zero"].file).toMatch(/StatusProj[\\/]Basic\.lean$/);
    expect(res["StatusProj.double"]).toMatchObject({ state: "proved", kind: "def" });
    expect(res["Nat.add_comm"].state).toBe("proved"); // toolchain declaration: found, no sorry
    expect(res["StatusProj.broken_type"].state).toBe("unknown"); // declared only in the unbuilt Broken.lean
    expect(Object.keys(res).sort()).toEqual([...names].sort());
  });

  it("lists declarations of the project modules, optionally filtered by prefix", async () => {
    const all = await runListQuery({ ...common() });
    const names = all.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(["StatusProj.proved_add_zero", "StatusProj.stated_sorry", "StatusProj.and_swap", "StatusProj.double"]));
    expect(names.every((n) => n.startsWith("StatusProj."))).toBe(true);
    expect(all.find((d) => d.name === "StatusProj.and_swap")).toMatchObject({ kind: "theorem", line: 3 });
    expect(all.find((d) => d.name === "StatusProj.and_swap")!.file).toMatch(/Goals\.lean$/);
    const some = await runListQuery({ ...common(), prefix: "StatusProj.stated" });
    expect(some.map((d) => d.name)).toEqual(["StatusProj.stated_sorry"]);
  });

  it("an unbuilt project (no oleans) yields `unknown`, never an exception", async () => {
    const res = await runStatusQuery({ ...common(), projectRoot: process.cwd(), names: ["Foo.bar"], modules: [] });
    expect(res["Foo.bar"].state).toBe("unknown");
    expect(res["Foo.bar"].source).toBe("none");
  });

  it("an import failure (module without olean) yields `unknown` for all names", async () => {
    const res = await runStatusQuery({ ...common(), names: ["StatusProj.double"], modules: ["StatusProj.Broken"] });
    expect(res["StatusProj.double"].state).toBe("unknown");
  });

  it("handles many names (chunked) and odd names without crashing", async () => {
    const names = Array.from({ length: 250 }, (_, i) => `StatusProj.missing_${i}`).concat(["«weird name»", "Nat.«add_comm»"]);
    const res = await runStatusQuery({ ...common(), names });
    expect(Object.keys(res).length).toBe(names.length);
    expect(res["StatusProj.missing_249"].state).toBe("unknown");
    expect(res["Nat.«add_comm»"].state).toBe("proved");
  }, 120000);
});
