import type { NodeInfo } from "$shared/types";

import { ensureTolgeeCategory } from "./category";
import { applyAnnotations } from "./sync";

const DEBOUNCE_MS = 200;

let timer: ReturnType<typeof setTimeout> | null = null;
// Whether annotations are currently enabled. Tracked here so a pending timer
// that fires AFTER the toggle was switched off doesn't re-apply annotations.
let active = false;
const queue = new Set<string>();
// Fresh snapshots handed over by write paths, so the reconcile pass doesn't
// re-read pluginData for nodes we just wrote. Later writes for the same id
// overwrite earlier entries — the newest snapshot wins.
const knownInfo = new Map<string, NodeInfo>();

/**
 * Schedule a coalesced reconcile pass for the given node ids. Multiple calls
 * within `DEBOUNCE_MS` collapse into a single async run, which keeps
 * `selectionchange`-driven calls cheap.
 *
 * The reconciler is a no-op in dev mode (annotations API is read-only) and
 * when the toggle is disabled.
 */
export function scheduleReconcile(nodeIds: string[], enabled: boolean, infos?: NodeInfo[]): void {
  if (!enabled) return;
  if (figma.editorType === "dev") return;
  active = true;
  for (const id of nodeIds) {
    queue.add(id);
  }
  if (infos) {
    for (const info of infos) {
      knownInfo.set(info.id, info);
    }
  }
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    void runReconcile();
  }, DEBOUNCE_MS);
}

/**
 * Cancel any pending reconcile and drop the queued node ids. MUST be called
 * when annotations are turned off (before `clearCurrentPage`), otherwise a
 * debounced pass scheduled just before the toggle would fire afterwards and
 * re-add the annotations that were just cleared.
 */
export function cancelReconcile(): void {
  active = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  queue.clear();
  knownInfo.clear();
}

async function runReconcile(): Promise<void> {
  timer = null;
  // Re-check at run time: the toggle may have been switched off between
  // scheduling and firing. (Belt-and-braces alongside `cancelReconcile`.)
  if (!active) {
    queue.clear();
    knownInfo.clear();
    return;
  }
  const ids = Array.from(queue);
  queue.clear();
  const infoById = new Map(knownInfo);
  knownInfo.clear();
  if (ids.length === 0) return;

  const categoryId = await ensureTolgeeCategory();
  const nodes: TextNode[] = [];
  let resolved = 0;
  for (const id of ids) {
    // The toggle can flip off between any two awaits — stop instead of
    // finishing a run whose annotations `clearCurrentPage` is about to (or
    // already did) remove.
    if (!active) return;
    const node = await figma.getNodeByIdAsync(id);
    if (node && node.type === "TEXT") {
      nodes.push(node);
    }
    resolved++;
    // Yield periodically — this runs right after bulk writes, when the canvas
    // thread has just done a batch of work already.
    if (resolved % 50 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  if (nodes.length === 0) return;
  await applyAnnotations(nodes, categoryId, infoById, () => !active);
}
