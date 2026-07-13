import { TOLGEE_NODE_INFO } from "$shared/constants";
import type { NodeInfo } from "$shared/types";

import { getNodeInfo } from "$main/nodes/getNodeInfo";

import { ensureTolgeeCategory } from "./category";

/**
 * Build the label shown on the canvas. Plain text — the Tolgee category
 * already differentiates these from other annotations, no need for bold.
 */
function buildLabel(info: NodeInfo): string {
  return info.ns ? `${info.ns}.${info.key}` : info.key;
}

/**
 * Write `next` into `node.annotations`. We deliberately do NOT normalize or
 * clone foreign annotations — they're handed back from Figma's reader and
 * the setter accepts them verbatim. Cloning into plain objects has caused
 * silent reverts when the foreign annotation carries internal markers our
 * naive clone drops, so it's safer to round-trip the read-only references.
 *
 * Wrapped in try/catch so a single bad node doesn't abort the entire sync.
 */
function writeAnnotations(node: TextNode, next: ReadonlyArray<Annotation>): boolean {
  try {
    node.annotations = next;
    return true;
  } catch (err) {
    console.warn(
      `[tolgee] failed to update annotations on ${node.id}:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Apply Tolgee annotations to the given text nodes. Annotations of unrelated
 * categories are preserved. Returns the number of nodes whose annotation
 * array we actually mutated.
 *
 * Identical-write detection is intentional: every mutation can race with
 * concurrent co-editors and produce visible "blink" in the canvas. Skipping
 * no-ops keeps the experience quiet for everyone in the file.
 *
 * `infoById` lets write paths hand over the `NodeInfo` snapshots they just
 * produced, skipping a per-node pluginData read + parse. Only our own writes
 * change `tolgee_info`, so a snapshot from the triggering write is current.
 */
export async function applyAnnotations(
  nodes: TextNode[],
  categoryId: string,
  infoById?: ReadonlyMap<string, NodeInfo>,
  isCancelled?: () => boolean,
): Promise<number> {
  let updated = 0;
  let processed = 0;
  let writesSinceYield = 0;
  for (const node of nodes) {
    processed++;
    // Annotation WRITES are canvas mutations (undo history, multiplayer sync)
    // and are by far the expensive part — a bulk key change rewrites the label
    // on every node. Yield after a handful of writes, and every ~50 nodes even
    // when the identical-write check skips them all, so neither a write burst
    // nor a long read-only pass freezes the editor.
    if (writesSinceYield >= 10 || processed % 50 === 0) {
      writesSinceYield = 0;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      // The yield is exactly where a toggle-off (cancel + clearCurrentPage)
      // can interleave — stop instead of re-writing labels onto freshly
      // cleared nodes.
      if (isCancelled?.()) return updated;
    }
    const info = infoById?.get(node.id) ?? getNodeInfo(node);
    // One bridge read; `annotations` is consulted three times below.
    const annotations = node.annotations;
    const others = annotations.filter((a) => a.categoryId !== categoryId);

    if (info.connected && info.key) {
      const label = buildLabel(info);
      const existing = annotations.find((a) => a.categoryId === categoryId);
      if (existing && existing.labelMarkdown === label && others.length === annotations.length - 1) {
        // Nothing changed for our annotation; leave the node alone.
        continue;
      }
      const ok = writeAnnotations(node, [...others, { labelMarkdown: label, categoryId }]);
      if (ok) {
        updated++;
        writesSinceYield++;
      }
    } else if (others.length !== annotations.length) {
      // The node lost its Tolgee key — strip our annotation but keep others.
      const ok = writeAnnotations(node, [...others]);
      if (ok) {
        updated++;
        writesSinceYield++;
      }
    }
  }
  return updated;
}

/**
 * Remove Tolgee annotations from the given nodes. Annotations of unrelated
 * categories are preserved.
 */
export async function removeAnnotations(nodes: TextNode[], categoryId: string): Promise<number> {
  let updated = 0;
  let processed = 0;
  let writesSinceYield = 0;
  for (const node of nodes) {
    processed++;
    // Same breathing rules as `applyAnnotations`: yield after a few canvas
    // writes, and periodically even on a pure read pass (this can walk every
    // text node on the page when called from `clearCurrentPage`).
    if (writesSinceYield >= 10 || processed % 100 === 0) {
      writesSinceYield = 0;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    // One bridge read per node.
    const annotations = node.annotations;
    const filtered = annotations.filter((a) => a.categoryId !== categoryId);
    if (filtered.length === annotations.length) continue;
    const ok = writeAnnotations(node, [...filtered]);
    if (ok) {
      updated++;
      writesSinceYield++;
    }
  }
  return updated;
}

/**
 * Reconcile annotations across every connected text node on the current page.
 * Returns `{ updated: 0 }` in dev mode, where the API is read-only.
 */
export async function syncCurrentPage(): Promise<{ updated: number }> {
  if (figma.editorType === "dev") {
    return { updated: 0 };
  }
  await figma.currentPage.loadAsync();
  const categoryId = await ensureTolgeeCategory();
  const nodes = figma.currentPage.findAllWithCriteria({
    types: ["TEXT"],
    pluginData: { keys: [TOLGEE_NODE_INFO] },
  });
  const updated = await applyAnnotations(nodes, categoryId);
  return { updated };
}

/**
 * Strip every Tolgee annotation from the current page. Used when the user
 * turns the toggle off.
 */
export async function clearCurrentPage(): Promise<{ updated: number }> {
  if (figma.editorType === "dev") {
    return { updated: 0 };
  }
  await figma.currentPage.loadAsync();
  const categoryId = await ensureTolgeeCategory();
  const all = figma.currentPage.findAllWithCriteria({ types: ["TEXT"] });
  // `findAllWithCriteria` can't filter on annotations, so this walks every
  // text node — detection and removal share one `annotations` read per node
  // (see removeAnnotations), with yields inside the removal loop.
  const updated = await removeAnnotations(all, categoryId);
  return { updated };
}
