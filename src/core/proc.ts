import { spawn, type ChildProcess } from "node:child_process";

/**
 * Kill a child and everything it spawned. POSIX: the child must have been spawned `detached: true` (own process
 * group) so `-pid` addresses the group; SIGTERM, then SIGKILL after 2 s. Windows: `taskkill /T /F`.
 * (Same approach as TeXPane's killTree.)
 */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, shell: false }).on("error", () => undefined);
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      const t = setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }, 2000);
      // Electron's renderer setTimeout returns a number (no unref)
      (t as { unref?: () => void }).unref?.();
    }
  } catch {
    /* ignore */
  }
}

/** True when a process with this pid exists (signal 0 probe). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
