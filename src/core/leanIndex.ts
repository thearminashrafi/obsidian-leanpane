/** Finds Lean projects among vault paths. Pure; no "obsidian". A project is a folder with a lakefile. */

export interface LeanVaultProject {
  /** Vault-relative folder, "" for the vault root. */
  root: string;
  /** Folder name (vault name placeholder "(vault root)" for the root). */
  name: string;
  lakefile: "lakefile.toml" | "lakefile.lean";
  /** Vault paths of the project's .lean files (nested projects excluded), sorted by path. */
  files: string[];
}

export interface LeanVaultIndex {
  projects: LeanVaultProject[];
  /** .lean files that belong to no project. */
  loose: string[];
}

const HIDDEN = /(^|\/)\.[^/]/;

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
function baseOf(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

export function buildLeanIndex(allFiles: string[]): LeanVaultIndex {
  const roots = new Map<string, "lakefile.toml" | "lakefile.lean">();
  for (const f of allFiles) {
    if (HIDDEN.test(f)) continue;
    const b = baseOf(f);
    if (b === "lakefile.toml") roots.set(dirOf(f), "lakefile.toml");
    else if (b === "lakefile.lean" && !roots.has(dirOf(f))) roots.set(dirOf(f), "lakefile.lean");
  }
  const owner = (path: string): string | null => {
    let d = dirOf(path);
    for (;;) {
      if (roots.has(d)) return d;
      if (d === "") return null;
      d = dirOf(d);
    }
  };
  const byRoot = new Map<string, string[]>();
  const loose: string[] = [];
  for (const f of allFiles) {
    if (!f.endsWith(".lean") || HIDDEN.test(f)) continue;
    const o = owner(f);
    if (o === null) loose.push(f);
    else (byRoot.get(o) ?? byRoot.set(o, []).get(o)!).push(f);
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
  const projects: LeanVaultProject[] = [...roots].map(([root, lakefile]) => ({
    root,
    name: root === "" ? "(vault root)" : baseOf(root),
    lakefile,
    files: (byRoot.get(root) ?? []).sort(cmp),
  }));
  projects.sort((a, b) => cmp(a.name, b.name) || cmp(a.root, b.root));
  return { projects, loose: loose.sort(cmp) };
}
