/**
 * Run a program to completion while streaming its output (for `lake new`, `lake build`, `lake exe cache get`).
 * Pure Node (no "obsidian"). Cancelling kills the whole process tree.
 */
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { killTree } from "./proc";

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Called with decoded chunks as they arrive. */
  onOutput?: (text: string, stream: "stdout" | "stderr") => void;
  signal?: AbortSignal;
}
export interface RunResult {
  code: number | null;
  cancelled: boolean;
}
export type RunFn = (file: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

/** Rejects only when the program cannot be started (ENOENT, EACCES). A non-zero exit is a result. */
export const runStreaming: RunFn = (file, args, opts = {}) =>
  new Promise<RunResult>((resolve, reject) => {
    if (opts.signal?.aborted) return resolve({ code: null, cancelled: true });
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let cancelled = false;
    const onAbort = (): void => {
      cancelled = true;
      killTree(child);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const pipe = (stream: NodeJS.ReadableStream | null, name: "stdout" | "stderr"): void => {
      if (!stream) return;
      const dec = new StringDecoder("utf8");
      stream.on("data", (b: Buffer) => opts.onOutput?.(dec.write(b), name));
      stream.on("end", () => {
        const rest = dec.end();
        if (rest) opts.onOutput?.(rest, name);
      });
    };
    pipe(child.stdout, "stdout");
    pipe(child.stderr, "stderr");
    child.once("error", (e) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(e);
    });
    child.once("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code, cancelled });
    });
  });
