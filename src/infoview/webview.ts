/**
 * Iframe side of the interactive infoview (milestone L3). Runs inside a sandboxed srcdoc iframe (opaque origin).
 * Flow: post `hello` -> host answers `init` with the module sources + theme -> we create Blob URLs, an import map
 * (via the official loader) and render the infoview -> register the InfoviewApi on the Rpc -> post `ready`.
 * See docs/INFOVIEW_NOTES.md.
 */
import type { EditorApi } from "@leanprover/infoview-api";
import { loadRenderInfoview } from "@leanprover/infoview/loader";
import type { FromFrame, ToFrame } from "./protocol";
import { EditorRpcApi, Rpc, editorApiOfRpc } from "./rpc";

const post = (m: FromFrame): void => parent.postMessage(m, "*");
const log = (message: string): void => post({ lp: "log", message });
let ready = false;
const fatal = (message: string): void => {
  if (!ready) post({ lp: "error", message });
  else log("error: " + message);
};

window.addEventListener("error", (e) => fatal(String(e.message ?? e.error)));
window.addEventListener("unhandledrejection", (e) => log("unhandled rejection: " + String((e.reason && (e.reason.stack || e.reason.message)) ?? e.reason)));

const rpc = new Rpc((m) => post({ lp: "rpc", m }));
let started = false;

function applyTheme(css: string, dark: boolean): void {
  let st = document.getElementById("lp-theme") as HTMLStyleElement | null;
  if (!st) {
    st = document.createElement("style");
    st.id = "lp-theme";
    document.head.appendChild(st);
  }
  st.textContent = css;
  const cls = dark ? "vscode-dark" : "vscode-light";
  document.body.classList.remove("vscode-dark", "vscode-light");
  document.body.classList.add(cls);
  document.body.setAttribute("data-vscode-theme-kind", cls);
}

function start(msg: Extract<ToFrame, { lp: "init" }>): void {
  if (started) return;
  started = true;
  try {
    const { assets } = msg;
    const blob = (s: string): string => URL.createObjectURL(new Blob([s], { type: "text/javascript" }));
    const imports = {
      "@leanprover/infoview": blob(assets.infoviewJs),
      react: blob(assets.reactJs),
      "react/jsx-runtime": blob(assets.jsxRuntimeJs),
      "react-dom": blob(assets.reactDomJs),
    };
    const st = document.createElement("style");
    st.textContent = assets.css;
    document.head.appendChild(st);
    applyTheme(msg.themeCss, msg.dark);
    const editorApi: EditorApi = editorApiOfRpc(rpc.getApi<EditorRpcApi>());
    const root = document.getElementById("react_root");
    if (!root) throw new Error("#react_root missing");
    loadRenderInfoview(imports, [editorApi as never, root], (api) => {
      void (async () => {
        try {
          rpc.register({ ...api });
          ready = true;
          post({ lp: "ready" });
        } catch (e) {
          fatal(String(e));
        }
      })();
    });
  } catch (e) {
    fatal(String((e as Error)?.stack ?? e));
  }
}

window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.source !== parent) return;
  const d = ev.data as ToFrame | undefined;
  if (!d || typeof d !== "object") return;
  if (d.lp === "rpc") rpc.messageReceived(d.m);
  else if (d.lp === "theme") applyTheme(d.themeCss, d.dark);
  else if (d.lp === "init") start(d);
});

post({ lp: "hello" });
