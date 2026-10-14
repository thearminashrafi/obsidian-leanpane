import { afterAll, beforeAll, expect, it } from "vitest";
import * as path from "node:path";
import { describeLean, ensureBuilt, fixturePath, openAndWait, startRawServer, STATUS_PROJ, type RawServer } from "../helpers/lean";
import { pidAlive } from "../../src/core/proc";

describeLean("lake serve smoke test (raw JSON-RPC from Node)", () => {
  let s: RawServer;
  beforeAll(async () => {
    ensureBuilt();
    s = await startRawServer(STATUS_PROJ);
  });
  afterAll(async () => {
    await s?.dispose();
  });

  it("initializes with Lean's custom capabilities", () => {
    expect(s.initializeResult.serverInfo?.name).toMatch(/lean/i);
    expect(s.initializeResult.capabilities.textDocumentSync).toBeDefined();
    expect(s.initializeResult.capabilities.experimental?.rpcProvider).toBeDefined();
  });

  it("publishes a 'declaration uses sorry' warning for a file with sorry", async () => {
    const { uri } = await openAndWait(s, fixturePath("status_proj", "StatusProj", "Basic.lean"));
    const diag = s.notifications.filter((n) => n.method === "textDocument/publishDiagnostics" && n.params.uri === uri).pop()!;
    const msgs = diag.params.diagnostics.map((d: any) => d.message);
    expect(msgs.some((m: string) => m.includes("declaration uses 'sorry'"))).toBe(true);
  });

  it("answers documentSymbol and plainGoal", async () => {
    const file = path.join(STATUS_PROJ, "StatusProj", "Goals.lean");
    const { uri } = await openAndWait(s, file);
    const syms = await s.conn.sendRequest<any[]>("textDocument/documentSymbol", { textDocument: { uri } });
    expect(JSON.stringify(syms)).toContain("and_swap");
    const goal = await s.conn.sendRequest<any>("$/lean/plainGoal", { textDocument: { uri }, position: { line: 4, character: 4 } });
    expect(goal.goals.length).toBeGreaterThan(0);
  });

  it("dispose() leaves no lake/lean process behind", async () => {
    const pid = s.child.pid!;
    await s.dispose();
    for (let i = 0; i < 50 && pidAlive(pid); i++) await new Promise((r) => setTimeout(r, 100));
    expect(pidAlive(pid)).toBe(false);
  });
});
