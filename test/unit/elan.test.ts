import { describe, expect, it } from "vitest";
import { buildEnv, discoverElan, elanCandidateDirs, makeServerSpec, parseToolchainList, toolchainDownloadHint } from "../../src/core/elan";
import type { ExecFn, ProjectDescriptor } from "../../src/types";
import { memFs } from "../helpers/memfs";

const fakeExec = (table: Record<string, { stdout?: string; stderr?: string; code?: number }>): ExecFn & { calls: string[] } => {
  const calls: string[] = [];
  const fn = (async (file: string, args: string[]) => {
    const key = `${file.split(/[\\/]/).pop()} ${args.join(" ")}`.trim();
    calls.push(key);
    const hit = table[key];
    if (!hit) throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" });
    return { stdout: hit.stdout ?? "", stderr: hit.stderr ?? "", code: hit.code ?? 0 };
  }) as ExecFn & { calls: string[] };
  fn.calls = calls;
  return fn;
};

describe("elanCandidateDirs", () => {
  it("orders: settings override, ~/.elan/bin, then PATH entries; no duplicates", () => {
    const d = elanCandidateDirs({ settingsDir: "/opt/custom", platform: "darwin", home: "/Users/a", env: { PATH: "/usr/bin:/Users/a/.elan/bin:/opt/homebrew/bin" } });
    expect(d).toEqual(["/opt/custom", "/Users/a/.elan/bin", "/usr/bin", "/opt/homebrew/bin"]);
  });
  it("Windows uses USERPROFILE\\.elan\\bin and ';' separated Path", () => {
    const d = elanCandidateDirs({ settingsDir: "", platform: "win32", home: "C:\\Users\\a", env: { Path: "C:\\Windows;C:\\tools" } });
    expect(d).toEqual(["C:\\Users\\a\\.elan\\bin", "C:\\Windows", "C:\\tools"]);
  });
  it("empty settingsDir/null are ignored", () => {
    expect(elanCandidateDirs({ settingsDir: null, platform: "linux", home: "/h", env: {} })).toEqual(["/h/.elan/bin"]);
  });
});

describe("discoverElan", () => {
  const files = { "/h/.elan/bin/elan": "", "/h/.elan/bin/lake": "", "/h/.elan/bin/lean": "" };
  const table = {
    "elan --version": { stdout: "elan 4.2.4 (227caca13 2026-08-25)\n" },
    "lake --version": { stdout: "Lake version 5.0.0-src+e82306f (Lean version 4.25.1)\n" },
    "elan toolchain list": { stdout: "leanprover/lean4:v4.25.1 (default)\nstable\n" },
  };
  it("finds the shims in ~/.elan/bin and probes versions and toolchains", async () => {
    const info = await discoverElan({ platform: "linux", home: "/h", env: { PATH: "/usr/bin" }, fs: memFs(files), exec: fakeExec(table) });
    expect(info.binDir).toBe("/h/.elan/bin");
    expect(info.lakePath).toBe("/h/.elan/bin/lake");
    expect(info.leanPath).toBe("/h/.elan/bin/lean");
    expect(info.elanPath).toBe("/h/.elan/bin/elan");
    expect(info.elanVersion).toBe("elan 4.2.4 (227caca13 2026-08-25)");
    expect(info.lakeVersion).toContain("Lake version 5.0.0");
    expect(info.toolchains).toEqual(["leanprover/lean4:v4.25.1", "stable"]);
    expect(info.defaultToolchain).toBe("leanprover/lean4:v4.25.1");
  });
  it("settings override wins over ~/.elan/bin", async () => {
    const fs = memFs({ ...files, "/custom/lake": "", "/custom/lean": "" });
    const info = await discoverElan({ settingsDir: "/custom", platform: "linux", home: "/h", env: {}, fs, exec: fakeExec(table) });
    expect(info.binDir).toBe("/custom");
    expect(info.lakePath).toBe("/custom/lake");
    expect(info.elanPath).toBeNull(); // no elan binary there
  });
  it("returns nulls (never throws) when nothing is installed", async () => {
    const info = await discoverElan({ platform: "linux", home: "/h", env: { PATH: "/usr/bin" }, fs: memFs({}), exec: fakeExec({}) });
    expect(info).toMatchObject({ binDir: null, lakePath: null, leanPath: null, elanPath: null, toolchains: [] });
  });
  it("probe:false does not execute anything", async () => {
    const exec = fakeExec(table);
    const info = await discoverElan({ platform: "linux", home: "/h", env: {}, fs: memFs(files), exec, probe: false });
    expect(exec.calls).toEqual([]);
    expect(info.binDir).toBe("/h/.elan/bin");
    expect(info.elanVersion).toBeUndefined();
  });
  it("a failing probe leaves fields undefined but keeps the paths", async () => {
    const info = await discoverElan({ platform: "linux", home: "/h", env: {}, fs: memFs(files), exec: fakeExec({ "lake --version": { code: 1, stderr: "boom" } }) });
    expect(info.lakePath).toBe("/h/.elan/bin/lake");
    expect(info.lakeVersion).toBeUndefined();
    expect(info.toolchains).toEqual([]);
  });
});

describe("buildEnv", () => {
  it("prepends binDir to PATH without mutating the base env", () => {
    const base = { PATH: "/usr/bin:/bin", HOME: "/h" };
    const env = buildEnv({ binDir: "/h/.elan/bin" }, base, "linux");
    expect(env.PATH).toBe("/h/.elan/bin:/usr/bin:/bin");
    expect(env.HOME).toBe("/h");
    expect(base.PATH).toBe("/usr/bin:/bin");
  });
  it("is idempotent and tolerates a missing PATH or null binDir", () => {
    const once = buildEnv({ binDir: "/x" }, { PATH: "/a" }, "linux");
    expect(buildEnv({ binDir: "/x" }, once, "linux").PATH).toBe("/x:/a");
    expect(buildEnv({ binDir: "/x" }, {}, "linux").PATH).toBe("/x");
    expect(buildEnv({ binDir: null }, { PATH: "/a" }, "linux").PATH).toBe("/a");
  });
  it("keeps the original key case on Windows (Path) and uses ';'", () => {
    const env = buildEnv({ binDir: "C:\\e\\bin" }, { Path: "C:\\Windows" }, "win32");
    expect(env.Path).toBe("C:\\e\\bin;C:\\Windows");
    expect(env.PATH).toBeUndefined();
  });
  it("leaves unrelated variables (e.g. ELAN_TOOLCHAIN) alone", () => {
    expect(buildEnv({ binDir: "/x" }, { PATH: "/a", ELAN_TOOLCHAIN: "stable" }, "linux").ELAN_TOOLCHAIN).toBe("stable");
  });
});

describe("parseToolchainList", () => {
  it("parses names and the default marker", () => {
    expect(parseToolchainList("leanprover/lean4:v4.25.1 (default)\nleanprover/lean4:nightly-2025-01-01\n\n")).toEqual({
      toolchains: ["leanprover/lean4:v4.25.1", "leanprover/lean4:nightly-2025-01-01"],
      default: "leanprover/lean4:v4.25.1",
    });
  });
  it("handles 'no installed toolchains' and CRLF", () => {
    expect(parseToolchainList("no installed toolchains\n").toolchains).toEqual([]);
    expect(parseToolchainList("stable (default)\r\nbeta\r\n").toolchains).toEqual(["stable", "beta"]);
  });
});

describe("toolchainDownloadHint", () => {
  const installed = ["leanprover/lean4:v4.25.1", "stable"];
  it("is null when the toolchain is installed (with or without the origin prefix)", () => {
    expect(toolchainDownloadHint("leanprover/lean4:v4.25.1", installed)).toBeNull();
    expect(toolchainDownloadHint("v4.25.1", installed)).toBeNull();
    expect(toolchainDownloadHint("stable", installed)).toBeNull();
  });
  it("mentions the version that may be downloaded otherwise", () => {
    expect(toolchainDownloadHint("leanprover/lean4:v4.30.0", installed)).toBe("Preparing Lean (may download leanprover/lean4:v4.30.0)…");
  });
  it("is null for a missing lean-toolchain file", () => {
    expect(toolchainDownloadHint(null, installed)).toBeNull();
  });
});

describe("makeServerSpec", () => {
  const info = { binDir: "/h/.elan/bin", lakePath: "/h/.elan/bin/lake", leanPath: "/h/.elan/bin/lean", elanPath: "/h/.elan/bin/elan", toolchains: [] };
  const project: ProjectDescriptor = { root: "/v/proj", lakefile: "lakefile.toml", toolchain: "leanprover/lean4:v4.25.1", usesMathlib: false };
  it("project => lake serve in the project root with elan on PATH", () => {
    const spec = makeServerSpec(info, project, "/v/proj/A", { PATH: "/usr/bin" }, "linux");
    expect(spec).toMatchObject({ kind: "lake", command: "/h/.elan/bin/lake", args: ["serve", "--"], cwd: "/v/proj" });
    expect(spec.env.PATH).toBe("/h/.elan/bin:/usr/bin");
  });
  it("no project => lean --server in the file's folder", () => {
    const spec = makeServerSpec(info, null, "/v/loose", { PATH: "/usr/bin" }, "linux");
    expect(spec).toMatchObject({ kind: "lean", command: "/h/.elan/bin/lean", args: ["--server"], cwd: "/v/loose" });
  });
  it("falls back to bare command names when elan was not found", () => {
    const spec = makeServerSpec({ binDir: null, lakePath: null, leanPath: null, elanPath: null, toolchains: [] }, project, "/v/proj", { PATH: "/usr/bin" }, "linux");
    expect(spec.command).toBe("lake");
    expect(spec.env.PATH).toBe("/usr/bin");
  });
});
