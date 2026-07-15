import type { NodeInfo } from "$shared/types";
import { nextCorrelationId, on, send } from "$ui/lib/bus";
import { createIdleTimeout } from "$ui/lib/busRequest";

// Single-shot response (no streaming) — a fixed timeout from request time is
// fine, unlike the streamed screenshot/create-copy round-trips.
const TIMEOUT_MS = 30_000;

/**
 * Round-trip to the main thread for every connected text node on the current
 * page, independent of the user's selection. Cancels the response listener if
 * the caller aborts (svelte-query passes a signal for in-flight cancellation).
 * Also gives up after `TIMEOUT_MS` of no response, rejecting with a
 * descriptive Error — see `busRequest.ts`.
 */
export function requestPageConnectedNodes(signal?: AbortSignal): Promise<NodeInfo[]> {
  return new Promise((resolve, reject) => {
    const correlationId = nextCorrelationId();
    const cleanup = (): void => {
      off();
      watchdog.clear();
      signal?.removeEventListener("abort", onAbort);
    };
    const watchdog = createIdleTimeout(TIMEOUT_MS, () => {
      cleanup();
      reject(new Error("Timed out waiting for the page's connected nodes."));
    });
    const off = on("page-connected-nodes-result", (msg) => {
      if (msg.correlationId !== correlationId) return;
      cleanup();
      resolve(msg.nodes);
    });
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    send({ type: "request-page-connected-nodes", correlationId });
  });
}
