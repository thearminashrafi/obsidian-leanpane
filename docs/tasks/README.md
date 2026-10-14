# Worker tasks (stage 2)

Ten independent, self-contained tasks (numbering kept; task 08, the Unicode engine, was implemented and validated by the lead — `src/core/unicode.ts`, tests in the `unit` project). They touch **disjoint files**, so all of them can run in parallel.
Each task file says exactly what to read, what to edit, and the command to run. Tests were written first by the lead
and define "done". Stubs with the final signatures already exist (they `throw new Error("TODO(task NN)")`).

Common facts:
- LeanPane repo: `/home/claude/leanpane-build/obsidian-leanpane`. TeXPane repo (task 11 only): `/home/claude/texpane-build/texpane`.
- LeanPane tests of pending tasks live in the vitest project `tasks` (see `test/pending.ts`); run one file with
  `npx vitest run --project tasks <file>`. When the lead integrates a task, its tests move to the `unit`/`lean` projects.
- Real Lean (4.25.1) is installed (`export PATH=$HOME/.elan/bin:$PATH` is applied automatically by `test/helpers/lean.ts`).
  Lean's download host is blocked: never run anything that needs to download a toolchain.

| # | Task file | File(s) the worker writes | Test command (from repo root) | Size |
|---|-----------|---------------------------|-------------------------------|------|
| 01 | [01-elan.md](01-elan.md) | `src/core/elan.ts` | `npx vitest run --project tasks test/unit/elan.test.ts test/lean/elan.real.test.ts` | S |
| 02 | [02-projects.md](02-projects.md) | `src/core/projects.ts` | `npx vitest run --project tasks test/unit/projects.test.ts` | M |
| 03 | [03-server.md](03-server.md) | `src/core/server.ts` | `npx vitest run --project tasks test/unit/server.fake.test.ts test/lean/server.test.ts` | L |
| 04 | [04-documents.md](04-documents.md) | `src/core/documents.ts` | `npx vitest run --project tasks test/unit/documents.test.ts` | S |
| 05 | [05-live-status.md](05-live-status.md) | `src/core/liveStatus.ts` | `npx vitest run --project tasks test/unit/liveStatus.test.ts` | S–M |
| 06 | [06-goals.md](06-goals.md) | `src/core/goals.ts` | `npx vitest run --project tasks test/unit/goals.test.ts` | S–M |
| 07 | [07-status-query.md](07-status-query.md) | `src/core/statusQuery.ts` | `npx vitest run --project tasks test/unit/statusQuery.test.ts test/lean/statusQuery.test.ts` | M |
| 09 | [09-lean-language.md](09-lean-language.md) | `src/editor/leanLanguage.ts` | `npx vitest run --project tasks test/unit/leanLanguage.test.ts` | M |
| 10 | [10-templates.md](10-templates.md) | `src/core/templates.ts` | `npx vitest run --project tasks test/unit/templates.test.ts` | M |
| 11 | [11-blueprint-parser.md](11-blueprint-parser.md) | TeXPane: `src/core/blueprint.ts` | `cd /home/claude/texpane-build/texpane && npx vitest run test/blueprint.test.ts` | M |

Lead-owned (not tasks): `src/types.ts`, `src/core/proc.ts`, `src/core/nodeio.ts`, `src/core/statusQuery.lean.ts`
(the verified Lean query program), `src/integration/*`, `src/infoview/*`, every Obsidian-facing file, `styles.css`, tests and fixtures.
