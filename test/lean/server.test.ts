import { afterAll, beforeAll, expect, it } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import { LeanServer } from "../../src/core/server";
import { pidAlive } from "../../src/core/proc";
import type { LeanServerSpec } from "../../src/types";
import { describeLean, ensureBuilt, fileUri, leanTools, STATUS_PROJ } from "../helpers/lean";
import { waitUntil } from "../helpers/fakeServer";

describeLean("LeanServer against real `lake serve`", () => {
  let server: LeanServer;
  beforeAll(() => {
    ensureBuilt();
  });
  afterAll(async () => {
    await server?.stop();
  });

  const spec = (): LeanServerSpec => ({ kind: "lake", command: leanTools!.lake, args: ["serve", "--"], cwd: STATUS_PROJ, env: leanTools!.env });

  it("starts, serves diagnostics + documentSymbol + plainGoal for an open file", async () => {
    server = new LeanServer(spec(), { rootPath: STATUS_PROJ, backoffMs: [50, 50, 50], maxCrashes: 3 });
    await server.start();
    expect(server.initializeResult?.capabilities.textDocumentSync).toBeDefined();

    const file = path.join(STATUS_PROJ, "StatusProj", "Basic.lean");
    const uri = fileUri(file);
    const diags: any[] = [];
    let done = false;
    server.onNotification("textDocument/publishDiagnostics", (p) => p.uri === uri && diags.push(...p.diagnostics));
    server.onNotification("$/lean/fileProgress", (p) => p.textDocument.uri === uri && p.processing.length === 0 && (done = true));
    server.notify("textDocument/didOpen", { textDocument: { uri, languageId: "lean4", version: 1, text: fs.readFileSync(file, "utf8") } });
    await waitUntil(() => done, 60000);
    expect(diags.some((d) => String(d.message).includes("declaration uses 'sorry'"))).toBe(true);

    const syms = await server.request<any[]>("textDocument/documentSymbol", { textDocument: { uri } });
    expect(JSON.stringify(syms)).toContain("uses_sorry");
    const line = fs.readFileSync(file, "utf8").split("\n").findIndex((l) => l.includes("have h := stated_sorry n"));
    const goal = await server.request<any>("$/lean/plainGoal", { textDocument: { uri }, position: { line, character: 4 } });
    expect(goal.goals[0]).toContain("⊢ n * 1 + 0 = n");
  });

  it("restarts after the process is killed (SIGKILL) and works again", async () => {
    const pid1 = server.pid!;
    process.kill(pid1, "SIGKILL");
    await waitUntil(() => server.state !== "running", 10000);
    await waitUntil(() => server.state === "running", 30000);
    expect(server.pid).not.toBe(pid1);
    const uri = fileUri(path.join(STATUS_PROJ, "StatusProj", "Goals.lean"));
    server.notify("textDocument/didOpen", { textDocument: { uri, languageId: "lean4", version: 1, text: fs.readFileSync(path.join(STATUS_PROJ, "StatusProj", "Goals.lean"), "utf8") } });
    const syms = await server.request<any[]>("textDocument/documentSymbol", { textDocument: { uri } });
    expect(JSON.stringify(syms)).toContain("and_swap");
  }, 90000);

  it("stop() leaves no lake/lean process behind", async () => {
    const pid = server.pid!;
    await server.stop();
    await waitUntil(() => !pidAlive(pid), 8000);
    expect(server.state).toBe("stopped");
  });
});
