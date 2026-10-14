/**
 * Declaration status engine: combines the live state of open files (diagnostics + documentSymbol) with the
 * whole-project query (src/core/statusQuery.ts), caches per project and emits change events. Pure (no "obsidian").
 *
 * Rules (SPEC section 3, "Declaration status engine"):
 *  - live `error` / `stated` always wins for a declaration in an open file;
 *  - live `proved` is `proved`, unless the last build query said `proved-with-sorry-deps` (live cannot see dependencies);
 *  - without live information the build result is used; never queried names are `unknown`.
 */
import type { DeclState, DeclStatus, DeclSummary, Disposer, LiveDecl } from "../types";
import { symbolKindLabel } from "./lsp";

export interface LiveEntry {
  decl: LiveDecl;
  /** Absolute path of the file the declaration is in. */
  file: string;
}

const LIVE_TO_STATE: Record<LiveDecl["state"], DeclState> = { error: "error", stated: "stated", proved: "proved" };

/** Combine the live and build information about one declaration. Pure. */
export function combineStatus(name: string, live: LiveEntry | undefined, build: DeclStatus | undefined, now: number): DeclStatus {
  if (!live) {
    return build ? { ...build, name } : { name, state: "unknown", source: "none", updatedAt: now };
  }
  let state: DeclState = LIVE_TO_STATE[live.decl.state];
  if (live.decl.state === "proved" && build?.state === "proved-with-sorry-deps") state = "proved-with-sorry-deps";
  const out: DeclStatus = {
    name,
    state,
    file: live.file,
    line: live.decl.range.start.line + 1,
    source: "live",
    updatedAt: now,
  };
  const kind = build?.kind ?? symbolKindLabel(live.decl.symbolKind);
  if (kind) out.kind = kind;
  if (build?.signature !== undefined) out.signature = build.signature;
  return out;
}

export interface StatusEngineDeps {
  /** Whole-project query for the given names (absolute project root). Never rejects (failures yield `unknown`). */
  runStatus(projectRoot: string, names: string[]): Promise<Record<string, DeclStatus>>;
  runList(projectRoot: string, prefix?: string): Promise<DeclSummary[]>;
  now?: () => number;
  /** Cached "unknown" answers older than this are asked again (default 30 s). */
  unknownTtlMs?: number;
}

type Listener = (projectRoot: string, names: string[] | "all") => void;

interface ProjectCache {
  build: Map<string, DeclStatus>;
  /** Every name ever asked for; re-queried after a build. */
  asked: Set<string>;
  /** file (abs) -> live declarations by name */
  live: Map<string, Map<string, LiveEntry>>;
  /** Tail of the serialised query queue. */
  queue: Promise<unknown>;
}

export class StatusEngine {
  private readonly projects = new Map<string, ProjectCache>();
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;
  private readonly ttl: number;

  constructor(private readonly deps: StatusEngineDeps) {
    this.now = deps.now ?? Date.now;
    this.ttl = deps.unknownTtlMs ?? 30000;
  }

  onStatusChanged(cb: Listener): Disposer {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(projectRoot: string, names: string[] | "all"): void {
    if (Array.isArray(names) && names.length === 0) return;
    for (const l of [...this.listeners]) {
      try {
        l(projectRoot, names);
      } catch {
        /* a failing listener must not break the others */
      }
    }
  }

  private cache(root: string): ProjectCache {
    let c = this.projects.get(root);
    if (!c) {
      c = { build: new Map(), asked: new Set(), live: new Map(), queue: Promise.resolve() };
      this.projects.set(root, c);
    }
    return c;
  }

  private liveEntry(c: ProjectCache, name: string): LiveEntry | undefined {
    for (const m of c.live.values()) {
      const e = m.get(name);
      if (e) return e;
    }
    return undefined;
  }

  /** Live declarations of one project, newest information for each name. */
  liveDecls(projectRoot: string): LiveEntry[] {
    const c = this.projects.get(projectRoot);
    if (!c) return [];
    const byName = new Map<string, LiveEntry>();
    for (const m of c.live.values()) for (const [n, e] of m) byName.set(n, e);
    return [...byName.values()];
  }

  /**
   * Replace the live declarations of an open file (`decls === null`: the file was closed). Emits the names whose
   * live state, line or file changed.
   */
  setLive(projectRoot: string, file: string, decls: LiveDecl[] | null): void {
    const c = this.cache(projectRoot);
    const old = c.live.get(file) ?? new Map<string, LiveEntry>();
    const next = new Map<string, LiveEntry>();
    for (const d of decls ?? []) next.set(d.name, { decl: d, file });
    if (decls === null) c.live.delete(file);
    else c.live.set(file, next);
    const changed: string[] = [];
    for (const [n, e] of next) {
      const o = old.get(n);
      if (!o || o.decl.state !== e.decl.state || o.decl.range.start.line !== e.decl.range.start.line) changed.push(n);
    }
    for (const n of old.keys()) if (!next.has(n)) changed.push(n);
    this.emit(projectRoot, changed);
  }

  /** Status for the given names. `refresh` re-runs the whole-project query for all of them. */
  async getStatus(projectRoot: string, names: string[], opts: { refresh?: boolean } = {}): Promise<Record<string, DeclStatus>> {
    const c = this.cache(projectRoot);
    for (const n of names) c.asked.add(n);
    const now = this.now();
    const need = names.filter((n) => {
      if (opts.refresh) return true;
      const live = this.liveEntry(c, n);
      if (live && live.decl.state !== "proved") return false;
      const cached = c.build.get(n);
      if (!cached) return true;
      return cached.source === "none" && now - cached.updatedAt > this.ttl;
    });
    if (need.length > 0) await this.query(projectRoot, c, need);
    const out: Record<string, DeclStatus> = {};
    const t = this.now();
    for (const n of names) out[n] = combineStatus(n, this.liveEntry(c, n), c.build.get(n), t);
    return out;
  }

  /** Run the whole-project query for `names`, one query at a time per project, and emit what changed. */
  private query(projectRoot: string, c: ProjectCache, names: string[]): Promise<void> {
    const run = async (): Promise<void> => {
      let res: Record<string, DeclStatus>;
      try {
        res = await this.deps.runStatus(projectRoot, names);
      } catch {
        res = {};
      }
      const changed: string[] = [];
      for (const n of names) {
        const r = res[n] ?? { name: n, state: "unknown" as const, source: "none" as const, updatedAt: this.now() };
        const before = c.build.get(n);
        c.build.set(n, r);
        if (!before || before.state !== r.state || before.line !== r.line || before.file !== r.file) changed.push(n);
      }
      this.emit(projectRoot, changed);
    };
    const p = c.queue.then(run, run);
    c.queue = p.catch(() => undefined);
    return p;
  }

  /** After a successful `lake build`: drop cached build answers, re-query the names we know about, tell everyone. */
  async refreshAfterBuild(projectRoot: string): Promise<void> {
    const c = this.cache(projectRoot);
    const names = [...c.asked];
    c.build.clear();
    if (names.length > 0) await this.query(projectRoot, c, names);
    this.emit(projectRoot, "all");
  }

  /** Forget cached build answers without querying (e.g. toolchain changed). */
  invalidate(projectRoot: string): void {
    this.projects.get(projectRoot)?.build.clear();
    this.emit(projectRoot, "all");
  }

  /** Declarations of the project's built modules (optionally filtered by name prefix) plus live declarations of open files. */
  async listDeclarations(projectRoot: string, prefix = ""): Promise<DeclSummary[]> {
    let built: DeclSummary[] = [];
    try {
      built = await this.deps.runList(projectRoot, prefix);
    } catch {
      built = [];
    }
    const byName = new Map<string, DeclSummary>();
    for (const d of built) byName.set(d.name, d);
    for (const e of this.liveDecls(projectRoot)) {
      if (prefix && !e.decl.name.startsWith(prefix)) continue;
      byName.set(e.decl.name, {
        name: e.decl.name,
        kind: byName.get(e.decl.name)?.kind || symbolKindLabel(e.decl.symbolKind),
        file: e.file,
        line: e.decl.range.start.line + 1,
      });
    }
    return [...byName.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.name < b.name ? -1 : 1)));
  }

  dispose(): void {
    this.listeners.clear();
    this.projects.clear();
  }
}
