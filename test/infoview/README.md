# Infoview tests

Unit tests (no Lean, no browser; pure pieces + the host against a fake DOM/iframe):

    npx vitest run -c test/infoview/vitest.config.ts

(They live outside `test/unit`, so `npm test` does not include them until the workspace config adds `test/infoview/**`.)

End-to-end (real headless Chromium + real `lake serve`, fixture `test/fixtures/lean/status_proj`):

    export PATH=$HOME/.elan/bin:$PATH      # or LEANPANE_TEST_ELAN_BIN=<elan bin dir>
    node test/infoview/e2e/run.mjs [--keep]

`run.mjs` bundles `e2e/page.ts` (the real `InfoviewHost` + a fake `ILeanServer` bridged to Node through Playwright
`exposeFunction`) and `e2e/node.ts` (real `LeanServer`, drives the page). It mounts the sandboxed iframe, opens
`Goals.lean`, sets the cursor in a tactic proof and asserts the rendered infoview text contains `⊢ q ∧ p`, then moves the
cursor (`⊢ p`), checks theming/`refreshTheme()` and `dispose()`. Exit code 0 = pass, 2 = Lean not found.
Playwright is looked up in `PLAYWRIGHT_DIR`, `node_modules/playwright`, `/opt/npm-tools/node_modules/playwright`; the
browser in `PLAYWRIGHT_CHROMIUM` or `/opt/pw-browsers/chromium-*`. Build output goes to `test/infoview/e2e/.out/`.
