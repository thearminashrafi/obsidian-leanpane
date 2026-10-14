/**
 * Iframe side of the interactive infoview (milestone L3, lead-owned). Runs inside a sandboxed srcdoc iframe.
 * Stage-1 stub: only proves the official loader bundles. See docs/INFOVIEW_NOTES.md for the full plan.
 */
import { loadRenderInfoview } from "@leanprover/infoview/loader";
import { Rpc } from "./rpc";

export { loadRenderInfoview, Rpc };
(window as unknown as { __lpInfoview?: unknown }).__lpInfoview = { loadRenderInfoview, Rpc };
