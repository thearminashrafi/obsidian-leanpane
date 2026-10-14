import { describe, expect, it } from "vitest";
import { killAllQueries, runningQueryCount, treeExec } from "../../src/core/execTree";
import { pidAlive } from "../../src/core/proc";
import { waitUntil } from "../helpers/fakeServer";

// a parent that spawns a grandchild, prints the grandchild's pid, then idles
const TREE = "const {spawn}=require('child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(g.pid);setInterval(()=>{},1000)";

describe("treeExec", () => {
  it("returns stdout/stderr and the exit code", async () => {
    const r = await treeExec(process.execPath, ["-e", "console.log('hi');console.error('e');process.exit(3)"]);
    expect(r).toEqual({ stdout: "hi\n", stderr: "e\n", code: 3 });
  });
  it("rejects when the program cannot be started", async () => {
    await expect(treeExec("/definitely/not/here", [])).rejects.toThrow();
  });
  it.skipIf(process.platform === "win32")("kills the whole process tree on timeout", async () => {
    const t0 = Date.now();
    const r = await treeExec(process.execPath, ["-e", TREE], { timeoutMs: 400 });
    expect(r.code).not.toBe(0);
    expect(Date.now() - t0).toBeLessThan(5000);
    const gc = Number(r.stdout.trim());
    expect(gc).toBeGreaterThan(0);
    await waitUntil(() => !pidAlive(gc), 6000);
  });
  it.skipIf(process.platform === "win32")("killAllQueries (plugin unload) kills running queries and their children", async () => {
    const p = treeExec(process.execPath, ["-e", TREE], { timeoutMs: 60000 });
    await waitUntil(() => runningQueryCount() === 1, 3000);
    await new Promise((r) => setTimeout(r, 300));
    killAllQueries();
    const r = await p;
    expect(r.code).not.toBe(0);
    await waitUntil(() => !pidAlive(Number(r.stdout.trim())), 6000);
    expect(runningQueryCount()).toBe(0);
  });
});
