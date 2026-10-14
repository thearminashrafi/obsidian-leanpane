/**
 * Templates for new Lean files/projects and the blueprint skeleton. Pure strings, no I/O. TASK: docs/tasks/10-templates.md
 */
import type { TemplateFile } from "../types";

export function sanitizeProjectName(_name: string): string {
  throw new Error("TODO(task 10)");
}
export function libNameFor(_projectName: string): string {
  throw new Error("TODO(task 10)");
}
export function lakeNewArgs(_o: { name: string; mathlib: boolean }): string[] {
  throw new Error("TODO(task 10)");
}
export const MATHLIB_CACHE_ARGS: string[] = ["exe", "cache", "get"];
export function newLeanFileContent(_fileName: string): string {
  throw new Error("TODO(task 10)");
}
export function uniqueFileName(_base: string, _ext: string, _exists: (name: string) => boolean): string {
  throw new Error("TODO(task 10)");
}
export interface StarterLeanFile {
  /** Relative to the project root, "/" separators. */
  path: string;
  /** Lean module name, e.g. "Demo.Starter". */
  module: string;
  content: string;
  /** Unqualified theorem name inside namespace <lib>. */
  theoremName: string;
}
export function starterLeanFile(_libName: string): StarterLeanFile {
  throw new Error("TODO(task 10)");
}
export function blueprintFiles(_o: { projectName: string; libName: string; title?: string }): TemplateFile[] {
  throw new Error("TODO(task 10)");
}
