/**
 * Host side of the interactive infoview (milestone L3). Owner: stage-3 infoview agent. See docs/INFOVIEW_NOTES.md.
 * The workspace view (owned by the other stage-3 agent) uses ONLY this public surface; keep it stable.
 */
import type { InitializeResult, Position, Range } from "vscode-languageserver-protocol";
import type { ILeanServer, Logger } from "../types";

export interface InfoviewEditorActions {
  /** Insert text in the editor of `uri` ("here" = at `pos` or the cursor; "above" = on a new line above the cursor line). */
  insertText(uri: string, text: string, kind: "above" | "here", pos?: Position): Promise<void>;
  /** Apply an LSP WorkspaceEdit (only edits to files open in LeanPane need to work). */
  applyEdit(edit: unknown): Promise<void>;
  /** Open `uri` (a file:// URI) in LeanPane and select `selection`. */
  showDocument(uri: string, selection?: Range): Promise<void>;
  /** Re-elaborate the file (close + reopen it on the server). */
  restartFile(uri: string): Promise<void>;
  copyToClipboard(text: string): Promise<void>;
}

export interface InfoviewHostOptions {
  /** Element the iframe is appended to (the goals pane body). The host owns only what it appends. */
  container: HTMLElement;
  /** Current Lean server for the file shown (looked up on every call; null while none is running). */
  getServer(): ILeanServer | null;
  editor: InfoviewEditorActions;
  /** Called once if the iframe fails to load (no ready message within ~8 s, or an error); the view then shows plain goals. */
  onFailed(reason: string): void;
  log?: Logger;
}

export class InfoviewHost {
  constructor(_opts: InfoviewHostOptions) {}
  /** Create the iframe and load the infoview. Resolves true when it reported ready, false on failure (onFailed is also called). */
  mount(): Promise<boolean> {
    throw new Error("TODO(stage 3 infoview)");
  }
  /** Cursor moved / file switched: forwards `changedCursorLocation`. Call `initialize` happens on the first call. */
  setCursor(_uri: string, _pos: Position): void {
    throw new Error("TODO(stage 3 infoview)");
  }
  /** After every successful (re)start of the server: forwards `serverRestarted`. */
  serverRestarted(_result: InitializeResult): void {
    throw new Error("TODO(stage 3 infoview)");
  }
  serverStopped(_reason?: string): void {
    throw new Error("TODO(stage 3 infoview)");
  }
  /** Every client->server notification LeanPane sends (didOpen/didChange/didClose/didSave): forwards `sentClientNotification`. */
  sentClientNotification(_method: string, _params: unknown): void {
    throw new Error("TODO(stage 3 infoview)");
  }
  /** Re-read Obsidian's theme variables and push them into the iframe (call on the workspace "css-change" event). */
  refreshTheme(): void {
    throw new Error("TODO(stage 3 infoview)");
  }
  dispose(): void {}
}
