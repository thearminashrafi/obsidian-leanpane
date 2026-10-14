import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import type { DirFs, ExecFn } from "../types";

/** Real `ExecFn`: runs a program to completion (no shell). Rejects only on spawn failure (ENOENT etc.). */
export const defaultExec: ExecFn = (file, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { env: opts.env, cwd: opts.cwd, timeout: opts.timeoutMs ?? 10000, killSignal: "SIGKILL", windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") return reject(err);
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
  });

/** Real `DirFs` backed by node:fs/promises. */
export const nodeFs: DirFs = {
  exists: async (p) => {
    try {
      await fsp.access(p);
      return true;
    } catch {
      return false;
    }
  },
  readFile: (p) => fsp.readFile(p, "utf8"),
  readdir: (p) => fsp.readdir(p),
};
