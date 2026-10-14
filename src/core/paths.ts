/** Small pure path helpers (no "obsidian"). */
import * as path from "node:path";

/** Is `child` equal to or inside `parent`? Both absolute; compared after normalisation. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Absolute path of a vault-relative folder ("" = vault root), or null when it would leave the vault: absolute paths,
 * drive letters, `..` segments or backslash tricks are all rejected.
 */
export function resolveVaultFolder(vaultBase: string, folder: string): string | null {
  const f = folder.trim();
  if (f.includes("\0")) return null;
  if (f.startsWith("/") || f.startsWith("\\") || /^[A-Za-z]:/.test(f)) return null;
  const segs = f.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) return null;
  const abs = path.resolve(vaultBase, ...segs);
  return isInside(vaultBase, abs) ? abs : null;
}
