# Progress

**Status: 0.1.0 released, not yet tested inside Obsidian** (14 Oct 2026)

## Done
- Plan and build spec ([SPEC.md](SPEC.md)).
- Stage 1: scaffold, shared interfaces, verified Lean status query, real-Lean fixtures, worker task specs.
- Stage 2: core modules (elan discovery, projects and trust, server client, document sync, live status, plain goals, status query, Lean highlighting, templates) and TeXPane's blueprint parser.
- Stage 3: workspace view, plain and interactive goal view (official infoview in a sandboxed iframe, verified end to end against real Lean in Chromium), messages drawer, outline, server management, new project, status engine, LeanPane API; TeXPane 0.2.0 Lean integration.
- Stage 4: independent review; all findings fixed (trust gating for every Lean process, no lost edits on close, no false "missing" for unbuilt files, plugin load/unload events, popout windows, process cleanup, safe stub creation).

## Next
- Manual test pass in Obsidian on macOS: [MANUAL_TEST.md](MANUAL_TEST.md).
