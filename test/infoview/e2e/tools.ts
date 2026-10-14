/** Vitest-free copies of the few helpers from test/helpers/lean.ts that the e2e needs (it runs under plain node). */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface Tools { binDir: string; lake: string; env: NodeJS.ProcessEnv }
export function findTools(): Tools | null {
  const candidates = [process.env.LEANPANE_TEST_ELAN_BIN, path.join(os.homedir(), ".elan", "bin"), ...(process.env.PATH ?? "").split(path.delimiter)].filter(Boolean) as string[];
  for (const dir of candidates) {
    const lake = path.join(dir, "lake");
    if (fs.existsSync(lake) && fs.existsSync(path.join(dir, "lean"))) {
      const env = { ...process.env, PATH: dir + path.delimiter + (process.env.PATH ?? "") };
      if (spawnSync(lake, ["--version"], { env, timeout: 30000 }).status === 0) return { binDir: dir, lake, env };
    }
  }
  return null;
}
export const FIXTURE = path.resolve(__dirname, "..", "..", "fixtures", "lean", "status_proj");
export function copyFixtureToTmp(): string {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), "leanpane-iv-"));
  fs.cpSync(FIXTURE, dst, { recursive: true, filter: (src) => !src.includes(`${path.sep}.lake`) });
  return dst;
}
export function fileUri(p: string): string {
  return "file://" + encodeURI(path.resolve(p).replace(/\\/g, "/"));
}
