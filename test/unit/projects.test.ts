import { describe, expect, it, vi } from "vitest";
import {
  describeProject,
  detectMathlib,
  findProjectRoot,
  parseLeanToolchain,
  ProjectNotTrustedError,
  ProjectRegistry,
  toProjectInfo,
} from "../../src/core/projects";
import type { ILeanServer, LeanServerSpec, ProjectDescriptor, ServerState, ServerStateEvent } from "../../src/types";
import { memFs } from "../helpers/memfs";

describe("findProjectRoot", () => {
  const fs = memFs({
    "/v/proj/lakefile.toml": "",
    "/v/proj/A/B/x.lean": "",
    "/v/old/lakefile.lean": "",
    "/v/old/Foo.lean": "",
    "/v/both/lakefile.toml": "",
    "/v/both/lakefile.lean": "",
    "/v/nested/lakefile.toml": "",
    "/v/nested/sub/lakefile.lean": "",
    "/v/nested/sub/Deep/y.lean": "",
    "/v/loose/z.lean": "",
  });
  it("walks up from a directory to the nearest lakefile", async () => {
    expect(await findProjectRoot("/v/proj/A/B", fs)).toEqual({ root: "/v/proj", lakefile: "lakefile.toml" });
    expect(await findProjectRoot("/v/proj", fs)).toEqual({ root: "/v/proj", lakefile: "lakefile.toml" });
  });
  it("supports lakefile.lean and prefers lakefile.toml when both exist", async () => {
    expect(await findProjectRoot("/v/old", fs)).toEqual({ root: "/v/old", lakefile: "lakefile.lean" });
    expect(await findProjectRoot("/v/both", fs)).toEqual({ root: "/v/both", lakefile: "lakefile.toml" });
  });
  it("the NEAREST lakefile wins", async () => {
    expect(await findProjectRoot("/v/nested/sub/Deep", fs)).toEqual({ root: "/v/nested/sub", lakefile: "lakefile.lean" });
  });
  it("returns null outside any project (and stops at the filesystem root)", async () => {
    expect(await findProjectRoot("/v/loose", fs)).toBeNull();
    expect(await findProjectRoot("/", fs)).toBeNull();
  });
});

describe("parseLeanToolchain", () => {
  it("returns the first meaningful line, trimmed", () => {
    expect(parseLeanToolchain("leanprover/lean4:v4.25.1\n")).toBe("leanprover/lean4:v4.25.1");
    expect(parseLeanToolchain("\n# comment\n  leanprover/lean4:nightly-2025-01-01  \r\n")).toBe("leanprover/lean4:nightly-2025-01-01");
  });
  it("returns null for empty input", () => {
    expect(parseLeanToolchain("  \n")).toBeNull();
  });
});

describe("detectMathlib", () => {
  it("lakefile.toml [[require]] with name mathlib (any quoting/case) or a mathlib4 git URL", () => {
    expect(detectMathlib("lakefile.toml", `name = "x"\n\n[[require]]\nname = "mathlib"\nscope = "leanprover-community"\nrev = "v4.25.0"\n`)).toBe(true);
    expect(detectMathlib("lakefile.toml", `[[require]]\nname = 'Mathlib'\ngit = "https://github.com/leanprover-community/mathlib4.git"\n`)).toBe(true);
    expect(detectMathlib("lakefile.toml", `[[require]]\nname = "batteries"\ngit = "https://github.com/leanprover-community/batteries"\n`)).toBe(false);
  });
  it("lakefile.lean require statements", () => {
    expect(detectMathlib("lakefile.lean", `import Lake\nopen Lake DSL\nrequire mathlib from git "https://github.com/leanprover-community/mathlib4.git"\n`)).toBe(true);
    expect(detectMathlib("lakefile.lean", `require "leanprover-community" / "mathlib" @ "git#v4.25.0"\n`)).toBe(true);
    expect(detectMathlib("lakefile.lean", `-- require mathlib from git "x"\nrequire batteries from git "y"\n`)).toBe(false);
  });
  it("is false for plain projects and does not trip over comments", () => {
    expect(detectMathlib("lakefile.toml", `name = "plain" # no mathlib here\n`)).toBe(false);
  });
});

describe("describeProject / toProjectInfo", () => {
  const fs = memFs({
    "/v/proj/lakefile.toml": `name = "p"\n[[require]]\nname = "mathlib"\n`,
    "/v/proj/lean-toolchain": "leanprover/lean4:v4.25.1\n",
    "/v/plain/lakefile.lean": "import Lake",
  });
  it("reads toolchain and mathlib usage", async () => {
    expect(await describeProject("/v/proj", "lakefile.toml", fs)).toEqual({ root: "/v/proj", lakefile: "lakefile.toml", toolchain: "leanprover/lean4:v4.25.1", usesMathlib: true });
    expect(await describeProject("/v/plain", "lakefile.lean", fs)).toEqual({ root: "/v/plain", lakefile: "lakefile.lean", toolchain: null, usesMathlib: false });
  });
  it("also detects mathlib through lake-manifest.json or .lake/packages/mathlib", async () => {
    const f2 = memFs({ "/a/lakefile.lean": "", "/a/lake-manifest.json": JSON.stringify({ packages: [{ name: "mathlib" }] }) });
    expect((await describeProject("/a", "lakefile.lean", f2)).usesMathlib).toBe(true);
    const f3 = memFs({ "/b/lakefile.lean": "", "/b/.lake/packages/mathlib/lakefile.lean": "" });
    expect((await describeProject("/b", "lakefile.lean", f3)).usesMathlib).toBe(true);
  });
  it("toProjectInfo makes the root vault-relative with '/' separators", () => {
    const d: ProjectDescriptor = { root: "/Users/a/Vault/Lean/proj", lakefile: "lakefile.toml", toolchain: "t", usesMathlib: false };
    expect(toProjectInfo(d, "/Users/a/Vault")).toEqual({ root: "Lean/proj", absRoot: "/Users/a/Vault/Lean/proj", toolchain: "t", usesMathlib: false });
    expect(toProjectInfo({ ...d, root: "/Users/a/Vault" }, "/Users/a/Vault").root).toBe("");
    expect(toProjectInfo({ ...d, toolchain: null }, "/Users/a/Vault").toolchain).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------------------------
class FakeServer implements ILeanServer {
  state: ServerState = "stopped";
  initializeResult = undefined;
  pid = undefined;
  starts = 0;
  stops = 0;
  private handlers: Array<(e: ServerStateEvent) => void> = [];
  constructor(readonly spec: LeanServerSpec) {}
  async start() {
    this.starts++;
    this.state = "running";
  }
  async stop() {
    this.stops++;
    this.state = "stopped";
  }
  async restart() {
    await this.stop();
    await this.start();
  }
  async request(): Promise<any> {
    return null;
  }
  notify() {}
  onNotification() {
    return () => {};
  }
  onRequest() {
    return () => {};
  }
  onState(h: (e: ServerStateEvent) => void) {
    this.handlers.push(h);
    return () => {};
  }
  stderrTail() {
    return [];
  }
}

function setup(over: { trusted?: boolean; idle?: number } = {}) {
  const created: FakeServer[] = [];
  const proj: ProjectDescriptor = { root: "/v/proj", lakefile: "lakefile.toml", toolchain: "t", usesMathlib: false };
  const timers: Array<{ fn: () => void; ms: number; id: number; cleared: boolean }> = [];
  let nextId = 1;
  const reg = new ProjectRegistry({
    factory: (spec) => {
      const s = new FakeServer(spec);
      created.push(s);
      return s;
    },
    makeSpec: (p, dir) => ({ kind: p ? "lake" : "lean", command: p ? "lake" : "lean", args: [], cwd: p ? p.root : dir, env: {} }),
    findProject: async (dir) => (dir.startsWith("/v/proj") ? proj : dir.startsWith("/v/other") ? { ...proj, root: "/v/other" } : null),
    ensureTrusted: vi.fn(async () => over.trusted ?? true),
    idleMinutes: () => over.idle ?? 10,
    timers: {
      setTimeout: (fn, ms) => {
        const t = { fn, ms, id: nextId++, cleared: false };
        timers.push(t);
        return t.id;
      },
      clearTimeout: (id) => {
        const t = timers.find((x) => x.id === id);
        if (t) t.cleared = true;
      },
    },
  });
  const fire = () => timers.filter((t) => !t.cleared).forEach((t) => ((t.cleared = true), t.fn()));
  return { reg, created, timers, fire, proj };
}

describe("ProjectRegistry", () => {
  it("one server per project, shared by all files; started once", async () => {
    const { reg, created } = setup();
    const [a, b] = await Promise.all([reg.acquire("/v/proj/A.lean"), reg.acquire("/v/proj/sub/B.lean")]);
    expect(created.length).toBe(1);
    expect(created[0].starts).toBe(1);
    expect(a.server).toBe(b.server);
    expect(a.project?.root).toBe("/v/proj");
    expect(a.key).toBe("/v/proj");
    const c = await reg.acquire("/v/other/C.lean");
    expect(created.length).toBe(2);
    expect(c.server).not.toBe(a.server);
  });

  it("files outside any project share a `lean --server` per folder, no trust prompt", async () => {
    const { reg, created } = setup();
    const x = await reg.acquire("/v/loose/x.lean");
    const y = await reg.acquire("/v/loose/y.lean");
    const z = await reg.acquire("/v/elsewhere/z.lean");
    expect(x.project).toBeNull();
    expect(x.server).toBe(y.server);
    expect(z.server).not.toBe(x.server);
    expect(created[0].spec.kind).toBe("lean");
  });

  it("asks for trust once per acquire of an unstarted project; refusal throws and creates no server", async () => {
    const { reg, created } = setup({ trusted: false });
    await expect(reg.acquire("/v/proj/A.lean")).rejects.toBeInstanceOf(ProjectNotTrustedError);
    expect(created.length).toBe(0);
  });

  it("idle shutdown: after the last release the server stops when the timer fires; re-acquire cancels it", async () => {
    const { reg, created, timers, fire } = setup({ idle: 10 });
    const a = await reg.acquire("/v/proj/A.lean");
    const b = await reg.acquire("/v/proj/B.lean");
    a.release();
    expect(timers.filter((t) => !t.cleared).length).toBe(0); // still one holder
    b.release();
    b.release(); // idempotent
    const pending = timers.filter((t) => !t.cleared);
    expect(pending.length).toBe(1);
    expect(pending[0].ms).toBe(10 * 60 * 1000);
    const again = await reg.acquire("/v/proj/C.lean"); // cancels the idle timer
    expect(timers.filter((t) => !t.cleared).length).toBe(0);
    expect(created.length).toBe(1);
    again.release();
    fire();
    await Promise.resolve();
    expect(created[0].stops).toBe(1);
    expect(reg.entries().length).toBe(0);
    const fresh = await reg.acquire("/v/proj/D.lean");
    expect(created.length).toBe(2);
    expect(fresh.server).not.toBe(created[0]);
  });

  it("idleMinutes = 0 never shuts down", async () => {
    const { reg, timers } = setup({ idle: 0 });
    const a = await reg.acquire("/v/proj/A.lean");
    a.release();
    expect(timers.length).toBe(0);
  });

  it("dispose() stops every server and clears timers", async () => {
    const { reg, created } = setup();
    await reg.acquire("/v/proj/A.lean");
    await reg.acquire("/v/other/B.lean");
    await reg.dispose();
    expect(created.map((s) => s.stops)).toEqual([1, 1]);
    expect(reg.entries().length).toBe(0);
  });

  it("peek() finds a running entry by key", async () => {
    const { reg } = setup();
    const a = await reg.acquire("/v/proj/A.lean");
    expect(reg.peek("/v/proj")).toBe(a.server);
    expect(reg.peek("/nope")).toBeUndefined();
  });
});
