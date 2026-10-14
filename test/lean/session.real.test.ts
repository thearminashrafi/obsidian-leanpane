import { afterAll, beforeAll, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LeanServer } from "../../src/core/server";
import { LeanSession } from "../../src/core/session";
import { createLeanProject } from "../../src/core/projectCreate";
import { runStreaming } from "../../src/core/runner";
import { describeLean, ensureBuilt, leanTools, STATUS_PROJ } from "../helpers/lean";
import { waitUntil } from "../helpers/fakeServer";

describeLean("LeanSession against real `lake serve`", () => {
  let server: LeanServer;
  beforeAll(() => {
    ensureBuilt();
  });
  afterAll(async () => {
    await server?.stop();
  });

  it("reports diagnostics, sorry lines and declarations for a fixture file", async () => {
    server = new LeanServer({ kind: "lake", command: leanTools!.lake, args: ["serve", "--"], cwd: STATUS_PROJ, env: leanTools!.env }, { rootPath: STATUS_PROJ, backoffMs: [50], maxCrashes: 2 });
    await server.start();
    const file = path.join(STATUS_PROJ, "StatusProj", "Basic.lean");
    const session = new LeanSession(
      { acquire: async () => ({ key: STATUS_PROJ, project: null, server, release: () => {} }), debounceMs: () => 20, analysisDelayMs: 50 },
      file,
    );
    await session.open(file, fs.readFileSync(file, "utf8"));
    await waitUntil(() => session.snapshot().decls.length > 0 && session.snapshot().processing.length === 0, 90000);
    const s = session.snapshot();
    expect(s.phase).toBe("running");
    expect(s.sorryCount).toBeGreaterThan(0);
    expect(s.sorryLines.length).toBeGreaterThan(0);
    expect(s.decls.some((d) => d.name.endsWith("uses_sorry"))).toBe(true);
    await session.close();
  }, 120000);
});

describeLean("createLeanProject with real lake (offline, no Mathlib)", () => {
  it("creates a plain project and a blueprint project", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "lp-real-new-"));
    try {
      const r = await createLeanProject({ parentDir: parent, name: "plain", mathlib: false, blueprint: false, lakePath: leanTools!.lake, env: leanTools!.env, run: runStreaming });
      expect(fs.existsSync(path.join(r.root, "lakefile.toml")) || fs.existsSync(path.join(r.root, "lakefile.lean"))).toBe(true);
      expect(fs.existsSync(r.mainLean)).toBe(true);
      const b = await createLeanProject({ parentDir: parent, name: "bp", mathlib: false, blueprint: true, lakePath: leanTools!.lake, env: leanTools!.env, run: runStreaming });
      expect(fs.existsSync(path.join(b.root, "blueprint", "src", "content.tex"))).toBe(true);
      expect(fs.readFileSync(path.join(b.root, "Bp.lean"), "utf8")).toContain("import Bp.Starter");
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }, 120000);
});
