declare module "virtual:infoview-assets" {
  const assets: {
    /** Iframe-side bootstrap (IIFE) built from src/infoview/webview.ts. */
    webviewJs: string;
    /** @leanprover/infoview ES module (bare imports: react, react-dom, react/jsx-runtime). */
    infoviewJs: string;
    reactJs: string;
    jsxRuntimeJs: string;
    reactDomJs: string;
    /** Infoview stylesheet with the codicon font inlined as a data: URI. */
    css: string;
  };
  export default assets;
}
