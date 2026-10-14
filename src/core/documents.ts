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

interface DocState {
  version: number;
  text: string;
  pending: TextDocumentContentChangeEvent[];
  timer: unknown | undefined;
}

const defaultTimers: TimerApi = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class DocumentSync {
  private readonly docs = new Map<string, DocState>();
  private readonly transport: SyncTransport;
  private readonly timers: TimerApi;
  private readonly debounceMs: number;
  private readonly languageId: string;
  private readonly maxPendingChanges: number;

  constructor(transport: SyncTransport, opts: DocumentSyncOptions = {}) {
    this.transport = transport;
    this.timers = opts.timers ?? defaultTimers;
    this.debounceMs = opts.debounceMs ?? 300;
    this.languageId = opts.languageId ?? "lean4";
    this.maxPendingChanges = opts.maxPendingChanges ?? 100;
  }

  /** didOpen (version 1) immediately. Already open => no-op. Returns the version. */
  open(uri: string, text: string): number {
    const existing = this.docs.get(uri);
    if (existing) return existing.version;
    this.docs.set(uri, { version: 1, text, pending: [], timer: undefined });
    this.transport.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: this.languageId, version: 1, text },
    });
    return 1;
  }

  /** Queue incremental changes (in order) and (re)start the debounce timer. `fullTextAfter` is the document text after them. */
  edit(uri: string, changes: TextDocumentContentChangeEvent[], fullTextAfter: string): void {
    const doc = this.docs.get(uri);
    if (!doc) return;
    doc.text = fullTextAfter;
    doc.pending.push(...changes);
    this.clearTimer(doc);
    doc.timer = this.timers.setTimeout(() => {
      doc.timer = undefined;
      this.flush(uri);
    }, this.debounceMs);
  }

  /** Send pending changes now (all documents when uri is omitted). */
  flush(uri?: string): void {
    if (uri !== undefined) {
      this.flushDoc(uri);
      return;
    }
    for (const u of [...this.docs.keys()]) this.flushDoc(u);
  }

  /** Drop pending changes, send didClose. */
  close(uri: string): void {
    const doc = this.docs.get(uri);
    if (!doc) return;
    this.clearTimer(doc);
    doc.pending = [];
    this.docs.delete(uri);
    this.transport.notify("textDocument/didClose", { textDocument: { uri } });
  }

  /** flush, then didSave. */
  save(uri: string): void {
    if (!this.docs.has(uri)) return;
    this.flush(uri);
    this.transport.notify("textDocument/didSave", { textDocument: { uri } });
  }

  /** After a server restart: didOpen again for every open document with its current text and a higher version. */
  reopenAll(): void {
    for (const [uri, doc] of this.docs) {
      this.clearTimer(doc);
      doc.pending = [];
      doc.version++;
      this.transport.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: this.languageId, version: doc.version, text: doc.text },
      });
    }
  }

  isOpen(uri: string): boolean {
    return this.docs.has(uri);
  }

  version(uri: string): number | undefined {
    return this.docs.get(uri)?.version;
  }

  text(uri: string): string | undefined {
    return this.docs.get(uri)?.text;
  }

  /** Cancel all timers; sends nothing. */
  dispose(): void {
    for (const doc of this.docs.values()) this.clearTimer(doc);
    this.docs.clear();
  }

  private flushDoc(uri: string): void {
    const doc = this.docs.get(uri);
    if (!doc) return;
    this.clearTimer(doc);
    if (doc.pending.length === 0) return;
    const contentChanges =
      doc.pending.length > this.maxPendingChanges ? [{ text: doc.text }] : doc.pending;
    doc.pending = [];
    doc.version++;
    this.transport.notify("textDocument/didChange", {
      textDocument: { uri, version: doc.version },
      contentChanges,
    });
  }

  private clearTimer(doc: DocState): void {
    if (doc.timer !== undefined) {
      this.timers.clearTimeout(doc.timer);
      doc.timer = undefined;
    }
  }
}
