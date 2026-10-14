/**
 * Run a short-lived query process (`lake env lean --run ...`) so that the WHOLE process tree dies on timeout and when
 * the plugin unloads. POSIX: spawned `detached` (own process group) and killed through `killTree`. Pure Node.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { ExecFn } from "../types";
import { killTree } from "./proc";

const MAX_OUTPUT = 16 * 1024 * 1024;

const live = new Set<ChildProcess>();

/** Kill every query process that is still running (plugin unload / app quit). */
export function killAllQueries(): void {
  for (const c of [...live]) killTree(c);
  live.clear();
}

/** Number of query processes currently running (tests). */
export function runningQueryCount(): number {
  return live.size;
}

/** `ExecFn` with tree-kill semantics. Rejects only when the program cannot be started (ENOENT, ...). */
export const treeExec: ExecFn = (file, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    live.add(child);
    let stdout = "";
    let stderr = "";
    let killed = false;
    const kill = (): void => {
      killed = true;
      killTree(child);
    };
    const timer = setTimeout(kill, opts.timeoutMs ?? 10000);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => {
      if (stdout.length + d.length > MAX_OUTPUT) return kill();
      stdout += d;
    });
    child.stderr?.on("data", (d: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += d;
    });
    let settled = false;
    child.once("error", (e) => {
      clearTimeout(timer);
      live.delete(child);
      if (settled) return;
      settled = true;
      if ((e as NodeJS.ErrnoException).code === "ENOENT" || !child.pid) reject(e);
      else resolve({ stdout, stderr, code: 1 });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      live.delete(child);
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, code: killed ? 1 : (code ?? 1) });
    });
  });
