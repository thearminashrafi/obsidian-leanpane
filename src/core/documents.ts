/**
 * Debounced didOpen/didChange/didClose/didSave bookkeeping for open documents. Pure (no "obsidian", no I/O). TASK: docs/tasks/04-documents.md
 */
import type { SyncTransport, TextDocumentContentChangeEvent, TimerApi } from "../types";

export interface DocumentSyncOptions {
  /** Quiet period before pending changes are sent. Default 300. */
  debounceMs?: number;
  timers?: TimerApi;
  languageId?: string; // default "lean4"
  /** More pending changes than this are replaced by one full-text change. Default 100. */
  maxPendingChanges?: number;
}

export class DocumentSync {
  constructor(_transport: SyncTransport, _opts: DocumentSyncOptions = {}) {
    throw new Error("TODO(task 04)");
  }
  /** didOpen (version 1) immediately. Already open => no-op. Returns the version. */
  open(_uri: string, _text: string): number {
    throw new Error("TODO(task 04)");
  }
  /** Queue incremental changes (in order) and (re)start the debounce timer. `fullTextAfter` is the document text after them. */
  edit(_uri: string, _changes: TextDocumentContentChangeEvent[], _fullTextAfter: string): void {
    throw new Error("TODO(task 04)");
  }
  /** Send pending changes now (all documents when uri is omitted). */
  flush(_uri?: string): void {
    throw new Error("TODO(task 04)");
  }
  /** Drop pending changes, send didClose. */
  close(_uri: string): void {
    throw new Error("TODO(task 04)");
  }
  /** flush, then didSave. */
  save(_uri: string): void {
    throw new Error("TODO(task 04)");
  }
  /** After a server restart: didOpen again for every open document with its current text and a higher version. */
  reopenAll(): void {
    throw new Error("TODO(task 04)");
  }
  isOpen(_uri: string): boolean {
    throw new Error("TODO(task 04)");
  }
  version(_uri: string): number | undefined {
    throw new Error("TODO(task 04)");
  }
  text(_uri: string): string | undefined {
    throw new Error("TODO(task 04)");
  }
  /** Cancel all timers; sends nothing. */
  dispose(): void {
    throw new Error("TODO(task 04)");
  }
}
