import { toProjectInfo } from "../core/projects";
import type { ProjectDescriptor } from "../types";
import type { LeanProjectInfo } from "./api-types";

/** `LeanProjectInfo` for a project, or null when its root is outside the vault. */
export function describeProjectInfo(project: ProjectDescriptor, vaultBase: string): LeanProjectInfo | null {
  const info = toProjectInfo(project, vaultBase);
  return info.root.startsWith("..") ? null : info;
}
