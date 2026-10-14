import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createLeanProject, libNameOf, ProjectCreateError } from "../../src/core/projectCreate";
import type { RunFn } from "../../src/core/runner";

const tmps: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lp-create-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Fake `lake`: `new <name> [math]` creates the files the real one does. */
function fakeLake(calls: string[][], opts: { failCache?: boolean; failNew?: boolean } = {}): RunFn {
  return async (_file, args, o) => {
    calls.push(args);
    o?.onOutput?.("running " + args.join(" ") + "\n", "stdout");
    const i = args.indexOf("new");
    if (i >= 0) {
      if (opts.failNew) return { code: 1, cancelled: false };
      const name = args[i + 1];
      const lib = name.split(/[-_]/).map((s) => s[0].toUpperCase() + s.slice(1)).join("");
      const root = path.join(o!.cwd!, name);
      fs.mkdirSync(path.join(root, lib), { recursive: true });
      fs.writeFileSync(path.join(root, "lakefile.toml"), `name = "${name}"\n\n[[lean_lib]]\nname = "${lib}"\n`);
      fs.writeFileSync(path.join(root, "lean-toolchain"), "leanprover/lean4:v4.25.1\n");
      fs.writeFileSync(path.join(root, `${lib}.lean`), `import ${lib}.Basic\n`);
      fs.writeFileSync(path.join(root, lib, "Basic.lean"), "def hello := 1\n");
      return { code: 0, cancelled: false };
    }
    if (args[0] === "exe") return { code: opts.failCache ? 1 : 0, cancelled: false };
    return { code: 0, cancelled: false };
  };
}

describe("createLeanProject", () => {
  it("creates a plain project: lake new only", async () => {
    const parent = tmp();
    const calls: string[][] = [];
    const log: string[] = [];
    const r = await createLeanProject({ parentDir: parent, name: "my-proj", mathlib: false, blueprint: false, lakePath: "lake", env: {}, run: fakeLake(calls), onLog: (t) => log.push(t) });
    expect(calls).toEqual([["new", "my-proj"]]);
    expect(r.root).toBe(path.join(parent, "my-proj"));
    expect(r.libName).toBe("MyProj");
    expect(r.mainLean).toBe(path.join(parent, "my-proj", "MyProj", "Basic.lean"));
    expect(r.contentTex).toBeUndefined();
    expect(log.join("")).toContain("lake new my-proj");
  });

  it("with Mathlib uses the template and fetches the cache; a failed cache is only a warning", async () => {
    const parent = tmp();
    const calls: string[][] = [];
    const r = await createLeanProject({ parentDir: parent, name: "m", mathlib: true, blueprint: false, lakePath: "lake", env: {}, run: fakeLake(calls, { failCache: true }) });
    expect(calls).toEqual([["+leanprover-community/mathlib4:lean-toolchain", "new", "m", "math"], ["exe", "cache", "get"]]);
    expect(r.warnings[0]).toMatch(/cache/i);
  });

  it("adds the blueprint skeleton, the starter theorem and imports it from the library root", async () => {
    const parent = tmp();
    const r = await createLeanProject({ parentDir: parent, name: "demo", mathlib: false, blueprint: true, lakePath: "lake", env: {}, run: fakeLake([]) });
    const root = r.root;
    for (const f of ["content", "print", "web"]) expect(fs.existsSync(path.join(root, "blueprint", "src", `${f}.tex`))).toBe(true);
    for (const f of ["common", "print", "web"]) expect(fs.existsSync(path.join(root, "blueprint", "src", "macros", `${f}.tex`))).toBe(true);
    expect(r.mainLean).toBe(path.join(root, "Demo", "Starter.lean"));
    expect(fs.readFileSync(r.mainLean, "utf8")).toContain("theorem starter_add_zero");
    expect(fs.readFileSync(path.join(root, "Demo.lean"), "utf8")).toBe("import Demo.Basic\nimport Demo.Starter\n");
    expect(fs.readFileSync(r.contentTex!, "utf8")).toContain("\\lean{Demo.starter_add_zero}");
  });

  it("refuses existing folders, empty names and reports a failing lake new", async () => {
    const parent = tmp();
    fs.mkdirSync(path.join(parent, "taken"));
    const base = { parentDir: parent, mathlib: false, blueprint: false, lakePath: "lake", env: {} };
    await expect(createLeanProject({ ...base, name: "taken", run: fakeLake([]) })).rejects.toThrow(/already exists/);
    await expect(createLeanProject({ ...base, name: "  ", run: fakeLake([]) })).rejects.toThrow(ProjectCreateError);
    await expect(createLeanProject({ ...base, name: "bad", run: fakeLake([], { failNew: true }) })).rejects.toThrow(/lake new failed/);
  });

  it("stops with 'Cancelled.' when the run is cancelled", async () => {
    const parent = tmp();
    const run: RunFn = async () => ({ code: null, cancelled: true });
    await expect(createLeanProject({ parentDir: parent, name: "c", mathlib: false, blueprint: false, lakePath: "lake", env: {}, run })).rejects.toThrow("Cancelled.");
  });
});

describe("libNameOf", () => {
  it("reads the library from the lakefile, else derives it", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "lakefile.toml"), 'name = "x"\n[[lean_lib]]\nname = "Custom"\n');
    expect(await libNameOf(d, "x")).toBe("Custom");
    expect(await libNameOf(tmp(), "some-name")).toBe("SomeName");
  });
});
