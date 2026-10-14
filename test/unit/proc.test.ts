import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { killTree, pidAlive } from "../../src/core/proc";
import { waitUntil } from "../helpers/fakeServer";

describe("killTree", () => {
  it.skipIf(process.platform === "win32")("kills a detached process group including grandchildren", async () => {
    const child = spawn(process.execPath, ["-e", "const {spawn}=require('child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(g.pid);setInterval(()=>{},1000)"], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
    const gc = await new Promise<number>((res) => child.stdout!.once("data", (d) => res(Number(String(d).trim()))));
    expect(pidAlive(child.pid!)).toBe(true);
    expect(pidAlive(gc)).toBe(true);
    killTree(child);
    await waitUntil(() => !pidAlive(child.pid!) && !pidAlive(gc), 6000);
  });
});
