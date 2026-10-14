/**
 * End-to-end check of the interactive infoview in headless Chromium against a REAL Lean server.
 *   export PATH=$HOME/.elan/bin:$PATH   # (or set LEANPANE_TEST_ELAN_BIN)
 *   node test/infoview/e2e/run.mjs [--keep]      # exit code 0 = pass
 * Needs Playwright (resolved from node_modules, /opt/npm-tools/node_modules or PLAYWRIGHT_DIR) and a Chromium
 * (PLAYWRIGHT_CHROMIUM or /opt/pw-browsers/chromium-*). See test/infoview/README.md.
 */
import esbuild from "esbuild";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = join(here, ".out");
mkdirSync(out, { recursive: true });
const require = createRequire(join(root, "package.json"));

// --- build: page bundle (host + assets virtual module) and node runner
const infoviewAssets = {
  name: "infoview-assets",
  setup(build) {
    build.onResolve({ filter: /^virtual:infoview-assets$/ }, () => ({ path: "infoview-assets", namespace: "lp-assets" }));
    build.onLoad({ filter: /.*/, namespace: "lp-assets" }, async () => {
      const distDir = dirname(require.resolve("@leanprover/infoview/package.json")) + "/dist";
      const read = (f) => readFileSync(`${distDir}/${f}`, "utf8");
      const webview = await esbuild.build({ entryPoints: [join(root, "src/infoview/webview.ts")], bundle: true, write: false, format: "iife", platform: "browser", target: "es2020", legalComments: "none" });
      const font = readFileSync(`${distDir}/codicon.ttf`).toString("base64");
      const css = read("index.css").replace(/url\(["']?\.\/codicon\.ttf[^)]*\)/g, `url("data:font/ttf;base64,${font}")`);
      const assets = { webviewJs: webview.outputFiles[0].text, infoviewJs: read("index.production.min.js"), reactJs: read("react.production.min.js"), jsxRuntimeJs: read("react-jsx-runtime.production.min.js"), reactDomJs: read("react-dom.production.min.js"), css };
      return { contents: `export default ${JSON.stringify(assets)};`, loader: "js" };
    });
  },
};
const page = await esbuild.build({ entryPoints: [join(here, "page.ts")], bundle: true, write: false, format: "iife", platform: "browser", target: "es2020", plugins: [infoviewAssets], absWorkingDir: root });
const pageJs = page.outputFiles[0].text;
await esbuild.build({ entryPoints: [join(here, "node.ts")], bundle: true, outfile: join(out, "node.mjs"), format: "esm", platform: "node", target: "node18", packages: "external", define: { __dirname: JSON.stringify(here) }, absWorkingDir: root });

// --- playwright + chromium
function findPlaywright() {
  for (const p of [process.env.PLAYWRIGHT_DIR, join(root, "node_modules/playwright"), "/opt/npm-tools/node_modules/playwright"]) {
    if (p && existsSync(p)) return p;
  }
  throw new Error("playwright not found; set PLAYWRIGHT_DIR");
}
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = "/opt/pw-browsers";
  if (existsSync(base)) for (const d of readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const p = join(base, d, "chrome-linux/chrome");
    if (existsSync(p)) return p;
  }
  return undefined; // let playwright use its default
}
const { chromium } = createRequire(import.meta.url)(findPlaywright());
const mod = await import(pathToFileURL(join(out, "node.mjs")).href);
const code = await mod.main({ chromium, executablePath: findChromium(), pageJs, root, keep: process.argv.includes("--keep") });
process.exit(code);
