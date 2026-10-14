import type { SessionSnapshot } from "./session";

export type StatusKind = "none" | "preparing" | "starting" | "checking" | "ready" | "error" | "restarting" | "failed" | "untrusted" | "no-lean";
export interface StatusLine {
  kind: StatusKind;
  /** Full status bar text, without the "Lean" prefix. */
  text: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Starting… / Checking 42% / Ready / Error · Lean 4.25.1 · 2 sorries" for the status bar. */
export function statusLine(s: SessionSnapshot | null, hasProject = true): StatusLine {
  if (!s || s.phase === "idle") return { kind: "none", text: "" };
  let kind: StatusKind;
  let head: string;
  switch (s.phase) {
    case "preparing":
      kind = /download/i.test(s.message) ? "preparing" : "starting";
      head = s.message.startsWith("Preparing") ? "Preparing…" : "Starting…";
      break;
    case "restarting":
      kind = "restarting";
      head = "Restarting…";
      break;
    case "failed":
      kind = "failed";
      head = "Failed";
      break;
    case "untrusted":
      kind = "untrusted";
      head = "Not trusted";
      break;
    case "no-lean":
      kind = "no-lean";
      head = "Lean not found";
      break;
    default: {
      if (s.processing.length > 0) {
        kind = "checking";
        head = `Checking ${Math.round(s.progress * 100)}%`;
      } else if (s.diagnostics.some((d) => d.severity === 1)) {
        kind = "error";
        head = "Error";
      } else {
        kind = "ready";
        head = "Ready";
      }
    }
  }
  const parts = [head];
  if (s.phase === "running") {
    if (s.leanVersion) parts.push(`Lean ${s.leanVersion}`);
    if (s.sorryCount > 0) parts.push(plural(s.sorryCount, "sorry", "sorries"));
    if (!hasProject) parts.push("no project");
  }
  return { kind, text: parts.join(" · ") };
}
