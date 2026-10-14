import { describe, expect, it } from "vitest";
import { runStreaming } from "../../src/core/runner";
import { killServerProcesses } from "../../src/core/shutdown";
import { pidAlive } from "../../src/core/proc";
import { spawn } from "node:child_process";

const node = process.execPath;

describe("runStreaming", () => {
  it("streams stdout and stderr and reports the exit code", async () => {
    const out: string[] = [];
    const r = await runStreaming(node, ["-e", "console.log('hello'); console.error('oops'); process.exit(3)"], { onOutput: (t, s) => out.push(`${s}:${t.trim()}`) });
    expect(r).toEqual({ code: 3, cancelled: false });
    expect(out.sort()).toEqual(["stderr:oops", "stdout:hello"]);
  });
  it("cancelling kills the process (and reports cancelled)", async () => {
    const ac = new AbortController();
    const started = new Promise<void>((res) => {
      void runStreaming(node, ["-e", "console.log('up'); setInterval(()=>{},1000)"], { signal: ac.signal, onOutput: () => res() }).then((r) => {
        expect(r.cancelled).toBe(true);
      });
    });
    await started;
    const done = runStreaming(node, ["-e", "console.log('x'); setInterval(()=>{},1000)"], { signal: ac.signal, onOutput: () => ac.abort() });
    const r = await done;
    expect(r.cancelled).toBe(true);
  });
  it("is cancelled at once when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    expect(await runStreaming(node, ["-e", "1"], { signal: ac.signal })).toEqual({ code: null, cancelled: true });
  });
  it("rejects when the program does not exist", async () => {
    await expect(runStreaming("/nonexistent/definitely-not-here", [])).rejects.toThrow();
  });
});

describe("killServerProcesses", () => {
  it("kills the process groups of the given servers and skips ones without a pid", async () => {
    const child = spawn(node, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
    const pid = child.pid!;
    expect(pidAlive(pid)).toBe(true);
    expect(killServerProcesses([{ pid }, { pid: undefined }])).toBe(1);
    await new Promise<void>((r) => child.once("exit", () => r()));
    expect(pidAlive(pid)).toBe(false);
  });
});
