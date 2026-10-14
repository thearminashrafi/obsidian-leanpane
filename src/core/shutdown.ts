/**
 * Synchronous last-resort cleanup used when Obsidian quits: kill the process tree of every Lean server we started.
 */
import type { ChildProcess } from "node:child_process";
import type { ILeanServer } from "../types";
import { killTree } from "./proc";

export function killServerProcesses(servers: Array<Pick<ILeanServer, "pid">>, platform: NodeJS.Platform = process.platform): number {
  let n = 0;
  for (const s of servers) {
    const pid = s.pid;
    if (!pid) continue;
    // killTree only needs `pid` (and `kill` as a fallback)
    killTree({ pid, kill: () => true } as unknown as ChildProcess, platform);
    n++;
  }
  return n;
}
