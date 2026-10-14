import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const prod = process.argv[2] === "production";
const require = createRequire(import.meta.url);

/**
 * Virtual module "virtual:infoview-assets": the official infoview (React app, React, CSS, font) and our iframe-side
 * bootstrap, inlined as strings so main.js is self-contained (see docs/INFOVIEW_NOTES.md).
 */
const infoviewAssets = {
  name: "infoview-assets",
  setup(build) {
    build.onResolve({ filter: /^virtual:infoview-assets$/ }, () => ({ path: "infoview-assets", namespace: "lp-assets" }));
    build.onLoad({ filter: /.*/, namespace: "lp-assets" }, async () => {
      const distDir = dirname(require.resolve("@leanprover/infoview/package.json")) + "/dist";
      const dist = (f) => `${distDir}/${f}`;
      const read = (f) => readFileSync(dist(f), "utf8");
      const webview = await esbuild.build({
        entryPoints: ["src/infoview/webview.ts"],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        target: "es2020",
        minify: prod,
        legalComments: "none",
      });
      const font = readFileSync(dist("codicon.ttf")).toString("base64");
      const css = read("index.css").replace(/url\(["']?\.\/codicon\.ttf[^)]*\)/g, `url("data:font/ttf;base64,${font}")`);
      const assets = {
        webviewJs: webview.outputFiles[0].text,
        infoviewJs: read("index.production.min.js"),
        reactJs: read("react.production.min.js"),
        jsxRuntimeJs: read("react-jsx-runtime.production.min.js"),
        reactDomJs: read("react-dom.production.min.js"),
        css,
      };
      return { contents: `export default ${JSON.stringify(assets)};`, loader: "js" };
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
    ...builtins.map((b) => `node:${b}`),
  ],
  plugins: [infoviewAssets],
  format: "cjs",
  target: "es2020",
  platform: "node",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  legalComments: "none",
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
