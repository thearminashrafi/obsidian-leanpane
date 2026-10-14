import type { DirFs } from "../../src/types";

/** In-memory DirFs for tests. Keys are absolute POSIX paths of FILES; directories are implied. Use "dir/" keys (trailing slash) for empty dirs. */
export function memFs(files: Record<string, string>): DirFs & { files: Record<string, string> } {
  const norm = (p: string) => p.replace(/\/+$/, "") || "/";
  const dirs = new Set<string>(["/"]);
  for (const k of Object.keys(files)) {
    const parts = norm(k).split("/").filter(Boolean);
    const upto = k.endsWith("/") ? parts.length : parts.length - 1;
    for (let i = 1; i <= upto; i++) dirs.add("/" + parts.slice(0, i).join("/"));
  }
  const fileKeys = Object.keys(files).filter((k) => !k.endsWith("/"));
  return {
    files,
    async exists(p) {
      const n = norm(p);
      return dirs.has(n) || fileKeys.includes(n);
    },
    async readFile(p) {
      const n = norm(p);
      if (!fileKeys.includes(n)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      return files[n];
    },
    async readdir(p) {
      const n = norm(p);
      if (!dirs.has(n)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      const prefix = n === "/" ? "/" : n + "/";
      const out = new Set<string>();
      for (const k of [...fileKeys, ...dirs]) if (k.startsWith(prefix) && k !== n) out.add(k.slice(prefix.length).split("/")[0]);
      return [...out].filter(Boolean).sort();
    },
  };
}
