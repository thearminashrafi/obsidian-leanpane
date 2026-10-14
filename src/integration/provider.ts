/**
 * LeanPaneApiV1 provider (SPEC section 6). Pure logic over injected dependencies, so it is unit-tested with fakes.
 *
 * Conventions (documented in the README, "TeXPane integration"):
 *  - every method accepts a project root either vault-relative (as in `LeanProjectInfo.root`) or absolute;
 *  - `onStatusChanged` callbacks receive the vault-relative root (`""` for a project at the vault root);
 *  - file paths in results (`DeclStatus.file`, `DeclSummary.file`, `createStub().file`) are vault-relative with "/" when the
 *    file is inside the vault and absolute otherwise.
 */
import * as path from "node:path";
import type { DeclStatus, DeclSummary, LeanPaneApiV1, LeanProjectInfo } from "./api-types";
import { API_VERSION } from "./api-types";
import { describeProjectInfo } from "./projectInfo";
import { appendStub, stubBlock } from "../core/lsp";
import type { StatusEngine } from "../core/statusEngine";
import type { ProjectDescriptor } from "../types";

export interface ProviderDeps {
  /** Absolute path of the vault folder. */
  vaultBase(): string;
  /** Nearest Lean project for a DIRECTORY (absolute), or null. */
  findProject(dirAbs: string): Promise<ProjectDescriptor | null>;
  isDirectory(abs: string): Promise<boolean>;
  engine: Pick<StatusEngine, "getStatus" | "listDeclarations" | "onStatusChanged">;
  /** Open the file at a 1-based line in LeanPane. Resolves false when the file cannot be opened. */
  openLocation(abs: string, line: number, opts: { newLeaf?: boolean; projectRoot: string }): Promise<boolean>;
  /** Current text of a Lean file (open editor buffer first), or null when it does not exist. */
  readFile(abs: string): Promise<string | null>;
  /** Replace/create a Lean file's text (through the open editor when there is one). */
  writeFile(abs: string, text: string): Promise<void>;
}

export function createLeanPaneApi(deps: ProviderDeps): LeanPaneApiV1 {
  const base = (): string => path.resolve(deps.vaultBase());

  const relToVault = (abs: string): string | null => {
    const rel = path.relative(base(), path.resolve(abs));
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return rel.split(path.sep).join("/");
  };
  const toApiPath = (abs: string | undefined): string | undefined => {
    if (abs === undefined) return undefined;
    return relToVault(abs) ?? abs;
  };
  const absRoot = (root: string): string => (path.isAbsolute(root) ? path.resolve(root) : path.resolve(base(), root));
  const apiRoot = (abs: string): string => relToVault(abs) ?? abs;

  const mapStatus = (s: DeclStatus): DeclStatus => {
    const file = toApiPath(s.file);
    return file === undefined ? s : { ...s, file };
  };

  return {
    version: API_VERSION,

    async projectForPath(vaultPath: string): Promise<LeanProjectInfo | null> {
      const abs = path.resolve(base(), vaultPath);
      const dir = (await deps.isDirectory(abs)) ? abs : path.dirname(abs);
      const project = await deps.findProject(dir);
      if (!project) return null;
      return describeProjectInfo(project, base());
    },

    async getStatus(projectRoot, names, opts) {
      const res = await deps.engine.getStatus(absRoot(projectRoot), names, opts);
      const out: Record<string, DeclStatus> = {};
      for (const n of names) if (res[n]) out[n] = mapStatus(res[n]);
      return out;
    },

    async listDeclarations(projectRoot, prefix) {
      const list = await deps.engine.listDeclarations(absRoot(projectRoot), prefix);
      return list.map((d: DeclSummary) => ({ ...d, file: toApiPath(d.file) ?? d.file }));
    },

    async openDeclaration(projectRoot, name, opts) {
      const root = absRoot(projectRoot);
      const res = await deps.engine.getStatus(root, [name]);
      const st = res[name];
      if (!st || !st.file) return false;
      const file = path.isAbsolute(st.file) ? st.file : path.resolve(root, st.file);
      return deps.openLocation(file, st.line ?? 1, { newLeaf: opts?.newLeaf, projectRoot: root });
    },

    async createStub(projectRoot, req) {
      const root = absRoot(projectRoot);
      const abs = resolveStubFile(req.file, base(), root);
      const existing = (await deps.readFile(abs)) ?? "";
      const { text, line } = appendStub(existing, stubBlock(req.name, req.docstring));
      await deps.writeFile(abs, text);
      return { file: toApiPath(abs) ?? abs, line };
    },

    onStatusChanged(cb) {
      return deps.engine.onStatusChanged((root, names) => cb(apiRoot(root), names));
    },
  };
}

/** `file` may be absolute, vault-relative or project-relative; prefer the reading that lies inside the project. */
export function resolveStubFile(file: string, vaultBase: string, projectAbs: string): string {
  if (path.isAbsolute(file)) return path.resolve(file);
  const inside = (p: string): boolean => {
    const rel = path.relative(projectAbs, p);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  const viaVault = path.resolve(vaultBase, file);
  if (inside(viaVault)) return viaVault;
  return path.resolve(projectAbs, file);
}
