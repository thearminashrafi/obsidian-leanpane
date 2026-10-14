/** Envelope messages exchanged between the host (Obsidian) and the sandboxed iframe via postMessage. */
export interface InfoviewAssetsPayload {
  infoviewJs: string;
  reactJs: string;
  jsxRuntimeJs: string;
  reactDomJs: string;
  css: string;
}
/** iframe -> host */
export type FromFrame =
  | { lp: "hello" } // bootstrap script is running and waits for `init`
  | { lp: "ready" } // infoview rendered and its InfoviewApi is registered on the Rpc
  | { lp: "error"; message: string } // fatal bootstrap failure
  | { lp: "log"; message: string }
  | { lp: "rpc"; m: unknown };
/** host -> iframe */
export type ToFrame =
  | { lp: "init"; assets: InfoviewAssetsPayload; themeCss: string; dark: boolean }
  | { lp: "theme"; themeCss: string; dark: boolean }
  | { lp: "rpc"; m: unknown };
