// Fake LSP server used by unit tests (spawned with `node fake-lsp.mjs`). Behaviour is selected by env FAKE_MODE:
//   ok                (default) normal handshake; answers `test/echo` with its params; `shutdown`/`exit` work.
//   crash-after-init  prints "fake crash" to stderr and exits with code 1 ~30 ms after `initialized`.
//   exit-immediately  prints "fake boot failure" to stderr and exits with code 3 before answering `initialize`.
//   hang-init         never answers `initialize`.
// Extra behaviour (any mode that completes the handshake):
//   request `test/slow`      never answers until a `$/cancelRequest` for it arrives, then fails with code -32800.
//   request `test/die`       exits the process immediately (code 9) without answering.
//   FAKE_GRANDCHILD=1        after `initialized`, spawns a detached-free `sleep`-like grandchild and sends notification
//                            `test/grandchild` {pid}.
//   after `initialized`      sends request `window/workDoneProgress/create` to the client and then notification
//                            `test/gotReply` {result} with the client's answer (null when the client has no handler).
//   notification `test/ping` -> replies with notification `test/pong` {n}.
import * as rpc from "vscode-jsonrpc/node";
import { spawn } from "node:child_process";

const mode = process.env.FAKE_MODE || "ok";
if (mode === "exit-immediately") {
  process.stderr.write("fake boot failure\n");
  process.exit(3);
}
const conn = rpc.createMessageConnection(new rpc.StreamMessageReader(process.stdin), new rpc.StreamMessageWriter(process.stdout));
const slow = new Map();

conn.onRequest("initialize", (params) => {
  if (mode === "hang-init") return new Promise(() => {});
  return {
    capabilities: { textDocumentSync: { openClose: true, change: 2 }, experimental: { rpcProvider: {} } },
    serverInfo: { name: "fake-lean-server", version: "0.0.0" },
  };
});
conn.onNotification("initialized", async () => {
  if (mode === "crash-after-init") {
    setTimeout(() => {
      process.stderr.write("fake crash\n");
      process.exit(1);
    }, 30);
    return;
  }
  if (process.env.FAKE_GRANDCHILD === "1") {
    const gc = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    conn.sendNotification("test/grandchild", { pid: gc.pid });
  }
  let result = "unset";
  try {
    result = await conn.sendRequest("window/workDoneProgress/create", { token: "t" });
  } catch (e) {
    result = { error: String(e) };
  }
  conn.sendNotification("test/gotReply", { result });
});
conn.onRequest("test/echo", (p) => p);
conn.onRequest("test/die", () => process.exit(9));
conn.onRequest("test/slow", (p, token) => new Promise((resolve, reject) => {
  token.onCancellationRequested(() => reject(new rpc.ResponseError(-32800, "cancelled")));
}));
let pongs = 0;
conn.onNotification("test/ping", () => conn.sendNotification("test/pong", { n: ++pongs }));
conn.onRequest("shutdown", () => null);
conn.onNotification("exit", () => process.exit(0));
conn.onNotification((method, params) => {
  if (method.startsWith("textDocument/")) conn.sendNotification("test/saw", { method, params });
});
conn.listen();
