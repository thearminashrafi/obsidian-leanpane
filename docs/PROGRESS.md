# Progress

**Status: in progress** (last updated 13 Oct 2026)

## Done
- Plan approved, with these decisions:
  - LeanPane is a separate plugin from TeXPane.
  - Proofs are written in blueprint-style LaTeX.
  - Mathlib is optional.
  - The interactive goal view is in the first release.
  - The repo is public.
- Build specification written ([SPEC.md](SPEC.md)).
- Build environment prepared: Lean 4.25.1 is installed, and `lake new`, `lake build` and `lake serve` are verified working, so integration tests can run against real Lean.

## Next
1. Lead engineer: project skeleton, shared interfaces (including the cross-plugin API in SPEC §6), real Lean test fixtures, and task specs for the core modules.
2. Core modules built in parallel against those tests: server client, status query, Unicode input, Lean highlighting, project templates, and TeXPane's blueprint parser.
3. Integration: Obsidian views, interactive goal view, TeXPane integration (TeXPane 0.2.0), progress panel.
4. Independent review, then release 0.1.0 and TeXPane 0.2.0.

## How it is built
A lead engineer agent owns the architecture and Obsidian-facing code. Smaller worker agents implement well-specified core modules against tests written by the lead. An independent reviewer checks everything before release. This is the same process used for TeXPane.
