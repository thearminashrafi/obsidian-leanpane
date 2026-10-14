import * as path from "node:path";
import type { LeanServerSpec } from "../../src/types";

/** Spec that launches test/helpers/fake-lsp.mjs with the given FAKE_MODE (see the header of that file). */
export function fakeSpec(mode: "ok" | "crash-after-init" | "exit-immediately" | "hang-init" = "ok", extraEnv: Record<string, string> = {}): LeanServerSpec {
  return {
    kind: "lean",
    command: process.execPath,
    args: [path.resolve(__dirname, "fake-lsp.mjs")],
    cwd: path.resolve(__dirname, "..", ".."),
    env: { ...process.env, FAKE_MODE: mode, ...extraEnv },
  };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export async function waitUntil(pred: () => boolean, timeoutMs = 10000, stepMs = 10): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("waitUntil timed out");
    await sleep(stepMs);
  }
}
