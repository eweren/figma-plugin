import type { KeyParentNames } from "$shared/keyFormat";
import { nextCorrelationId, on, send } from "$ui/lib/bus";

/**
 * Round-trip to the main thread to resolve the parent placeholder names
 * ({component}/{frame}/…) for specific nodes. Used by the bulk "Generate key
 * names" action when its template references a parent placeholder the selection
 * scan didn't pre-resolve (the saved key format didn't use it). Returns a map
 * keyed by node id; a missing id / field means the node has no such ancestor.
 */
export function resolveParentNames(
  nodeIds: string[],
): Promise<Record<string, KeyParentNames>> {
  return new Promise((resolve) => {
    const correlationId = nextCorrelationId();
    const off = on("parent-names-result", (msg) => {
      if (msg.correlationId !== correlationId) return;
      off();
      resolve(msg.parents);
    });
    send({ type: "resolve-parent-names", correlationId, nodeIds });
  });
}
