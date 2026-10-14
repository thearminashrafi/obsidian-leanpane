# Task 04 — Document synchronisation (`src/core/documents.ts`)

> You are a careful junior engineer. This file is self-contained: read it fully, then read ONLY the files it names.
> Do not read other files in the repo and do not change anything outside the files listed under "Files you may edit".

## Ground rules (all tasks)
- Repo: `/home/claude/leanpane-build/obsidian-leanpane` (Node 22, TypeScript 5.5 strict, ES modules, vitest 2). Do NOT run `git commit`/`git add`; the lead commits.
- Edit ONLY the files listed under "Files you may edit". Never edit tests, `src/types.ts`, `docs/`, or another task's file. If a test looks wrong or the spec contradicts it, do not "fix" the test: implement the most reasonable behaviour, and describe the problem in your final report.
- `src/core/*` must NOT import `obsidian` or anything from the browser/DOM. Use Node built-ins with the `node:` prefix (`node:path`, `node:fs/promises`, ...). Use `node:path` functions (never hard-coded `/` or `\\` separators) unless the task says otherwise; code must work on macOS, Linux and Windows.
- Keep the exported names and signatures from the contract below EXACTLY (the lead's integration code and the tests import them). You may add extra exports and private helpers inside your file.
- Replace each `throw new Error("TODO(task 04)")` stub with a real implementation. No `any` unless the contract already has it. No `console.log` in library code.
- Style: 2-space indent, double quotes, semicolons, trailing commas, width ~140. Short comments only where the logic is not obvious.
- Other workers edit other files at the same time. `npx tsc --noEmit` may show errors in files you do not own: ignore them; make sure none are in your file (`npx tsc --noEmit 2>&1 | grep <yourfile>`).

## Test command
```
cd /home/claude/leanpane-build/obsidian-leanpane && npx vitest run --project tasks test/unit/documents.test.ts
```
Run it repeatedly while you work. The task is done when every test in the named file(s) passes (or is skipped by its own `skipIf` for a missing tool) and `tsc` shows no errors in your file.

## Final report (your last message)
Keep it short: files changed; test results (passed/failed/skipped counts); any test you believe is wrong or any ambiguity in this spec, with your reasoning; anything the lead must know for integration.

## Purpose
The editor reports every keystroke; the language server should receive fewer, batched `textDocument/didChange` notifications (about one per 300 ms of quiet), with correct monotonically increasing versions. `DocumentSync` does that bookkeeping for all open `.lean` documents of one server. It has no I/O: it calls an injected transport.

## Files you may edit
- `src/core/documents.ts` (stub). May read `src/types.ts`, `test/unit/documents.test.ts`.

## Contract (current content of the stub — keep these signatures)
```ts
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
```

Types used (from `src/types.ts`; `TextDocumentContentChangeEvent` is the standard LSP type: `{ range?: Range; rangeLength?: number; text: string }`):
```ts
export interface SyncTransport {
  notify(method: string, params: any): void;
}

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
```

## Behaviour
- Per-document state: `version` (starts at 1 on open), `text` (latest known full text), `pending` changes array, debounce timer handle.
- `open(uri, text)`: if already open return its version without sending. Else send `textDocument/didOpen` with `{ textDocument: { uri, languageId, version: 1, text } }` (languageId default `"lean4"`).
- `edit(uri, changes, fullTextAfter)`: ignore unknown/closed uris. Set `text = fullTextAfter`, append `changes` to `pending`, clear and restart the debounce timer (`debounceMs`, default 300, via `opts.timers` defaulting to the global timers). When it fires → `flush(uri)`.
- `flush(uri?)`: for the given document (or all documents) with pending changes: clear its timer; `version++`; send `textDocument/didChange` with `{ textDocument: { uri, version }, contentChanges }` where `contentChanges` are the pending changes in order — unless `pending.length > maxPendingChanges` (default 100), then send ONE change `[{ text: fullText }]`. Clear `pending`. Nothing pending → send nothing.
- `close(uri)`: no-op for unknown uri; else drop pending, clear timer, send `textDocument/didClose` with `{ textDocument: { uri } }`, forget the document.
- `save(uri)`: `flush(uri)` then send `textDocument/didSave` with `{ textDocument: { uri } }` (no text). Unknown uri: no-op.
- `reopenAll()`: for every open document: clear timer and pending, `version++`, send `didOpen` with the CURRENT `text` and that new version. (The server restarted and knows nothing; LSP allows any version for a fresh didOpen.)
- `isOpen`, `version` (undefined if not open), `text` (undefined if not open).
- `dispose()`: clear all timers, send nothing, forget everything.

## Tests
`test/unit/documents.test.ts` uses a fake timer implementation. Definition of done.
