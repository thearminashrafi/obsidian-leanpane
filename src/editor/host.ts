import type { UnicodeEngine } from "../core/unicode";

/** What the CodeMirror extensions need from the view that owns the editor. */
export interface LeanEditorHost {
  /** LSP request for the open document; resolves null when no server is running. Pending edits are flushed first. */
  request<T = any>(method: string, params: any, signal?: AbortSignal): Promise<T | null>;
  uri(): string;
  hoverEnabled(): boolean;
  renderMarkdown(markdown: string, el: HTMLElement): void;
  /** Go to the definition of the identifier at `offset`. `newLeaf`: open it in a new tab. */
  gotoDefinition(offset: number, newLeaf: boolean): void;
  /** The Unicode abbreviation engine, or null when Unicode input is switched off. */
  unicode(): UnicodeEngine | null;
}
