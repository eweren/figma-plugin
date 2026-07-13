import { keyFormatUsesParents } from "$shared/keyFormat";
import type { NodeInfo } from "$shared/types";

import { readMergedConfig } from "$main/settings";
import { applyRichText } from "$main/text/applyRichText";
import { shouldIgnoreNode } from "./filter";
import { getNodeInfo, setNodeInfo } from "./getNodeInfo";
import { type MainComponentNameCache, resolveParentNames } from "./nodeParents";
import { scanSelectedTextNodes } from "./scan";

/**
 * Replace the rendered text of a `TextNode`, applying Tolgee's inline
 * formatting tags (`<b>` / `<i>` / `<u>` / `<br>`) to the corresponding
 * character ranges. See `$main/text/applyRichText` for the parsing details.
 *
 * Disables `autoRename` (via `applyRichText`) so the layer name doesn't
 * follow the new text — the Tolgee key is the source of truth.
 */
export async function writeTextNode(node: TextNode, newText: string): Promise<void> {
  await applyRichText(node, newText);
}

/**
 * Returns the text nodes the UI should currently focus on — always strictly
 * the user's selection:
 *
 * - If the user has a selection, we return the text nodes inside it (possibly
 *   an empty list, e.g. a frame with no text). Each is run through
 *   `shouldIgnoreNode` so the "ignore numbers / hidden layers / prefixed layer
 *   names" settings prune what shows up. The filter applies UNIFORMLY — a
 *   connected string in a hidden layer is hidden too, matching the original
 *   plugin (`findTextNodesInfo` runs the same `shouldIncludeNode` on every node,
 *   with no exception for connected ones).
 * - If nothing is selected, we return an empty list — we deliberately do NOT
 *   scan the whole page. On large files that page-wide `findAllWithCriteria`
 *   scan is a real performance hit, and silently listing the entire document
 *   is rarely what the user wants. The UI shows a "select something" empty
 *   state instead. Page-wide work still happens on demand in the Download/Pull
 *   flow via the dedicated `request-page-connected-nodes` path.
 */
export const getSelectionInfo = async (): Promise<{
  nodes: NodeInfo[];
  basedOnSelection: boolean;
}> => {
  const hasUserSelection = figma.currentPage.selection.length > 0;
  if (!hasUserSelection) {
    return { nodes: [], basedOnSelection: false };
  }

  // Config first (cached) — it decides the scan strategy: `ancestorHidden`
  // is only consumed by the opt-in "including children" hidden filter, and
  // skipping it unlocks the engine-side `findAllWithCriteria` fast path.
  const config = await readMergedConfig();
  const needsAncestorHidden = Boolean(
    (config.ignoreHiddenLayers ?? true) && config.ignoreHiddenLayersIncludingChildren,
  );
  const selected = await scanSelectedTextNodes(needsAncestorHidden);
  // Filter BEFORE building NodeInfo — `getNodeInfo` costs ~5 bridge calls per
  // node (pluginData + name + …), which ignored nodes must not pay. One loop
  // so `characters` crosses the bridge once per node (filter + info share it),
  // with periodic yields — 700 kept nodes are ~3k bridge calls, and doing
  // them unbroken visibly froze the canvas on every selection switch.
  const kept: { node: TextNode; info: NodeInfo }[] = [];
  let scanned = 0;
  for (const { node, ancestorHidden } of selected) {
    const characters = node.characters;
    if (!shouldIgnoreNode(node, ancestorHidden, config, characters)) {
      kept.push({ node, info: getNodeInfo(node, characters) });
    }
    scanned++;
    if (scanned % 50 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  // Fill the parent key-format placeholders ({component}/{frame}/…) from the
  // live tree — only when prefill is on AND the format actually uses one, so a
  // plain key format adds zero traversal cost. Per-node awaits (an INSTANCE
  // resolves its main component async) run in parallel.
  if (config.prefillKeyFormat && keyFormatUsesParents(config.keyFormat)) {
    // Shared per-scan cache: text nodes under the same INSTANCE ancestor
    // resolve its main component once instead of once each. Sequential with
    // periodic yields — a parallel batch of ancestor walks over a large
    // selection blocks the canvas until the whole burst finishes.
    const mainComponentNames: MainComponentNameCache = new Map();
    let resolved = 0;
    for (const { node, info } of kept) {
      const parents = await resolveParentNames(node, mainComponentNames);
      info.component = parents.component;
      info.instance = parents.instance;
      info.frame = parents.frame;
      info.artboard = parents.artboard;
      info.section = parents.section;
      info.group = parents.group;
      resolved++;
      if (resolved % 25 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  const nodes = kept.map(({ info }) => info);
  return { nodes, basedOnSelection: true };
};

export type NodeUpdate = {
  id: string;
  info: Partial<NodeInfo>;
};

/**
 * Apply a batch of partial `NodeInfo` updates. Each lookup goes through
 * `getNodeByIdAsync` because `documentAccess: "dynamic-page"` rules out the
 * synchronous variant. Non-text or missing nodes are skipped silently and do
 * not flip the result to `ok: false` — callers receive `ok: false` only when
 * an unexpected error escapes a single update.
 *
 * Returns the fresh post-write `NodeInfo` snapshots (we already hold the node
 * reference, so this costs no extra lookups). The UI patches its selection
 * from these instead of the main thread re-scanning the whole selection.
 */
export const setNodesData = async (
  updates: NodeUpdate[],
): Promise<{ ok: boolean; nodes: NodeInfo[] }> => {
  let ok = true;
  const nodes: NodeInfo[] = [];
  let processed = 0;
  for (const update of updates) {
    try {
      const node = await figma.getNodeByIdAsync(update.id);
      if (node && node.type === "TEXT") {
        // `setNodeInfo` already returns the exact post-write snapshot — no
        // second pluginData read needed.
        nodes.push(setNodeInfo(node, update.info));
      }
    } catch {
      ok = false;
    }
    processed++;
    // Yield every ~50 updates so a bulk write over a large selection doesn't
    // starve the canvas thread (pluginData-only writes are cheap).
    if (processed % 50 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return { ok, nodes };
};

export type ApplyTranslationUpdate = {
  id: string;
  /** Final, ICU-formatted string to write into `TextNode.characters`. */
  text: string;
  /** Raw translation source to persist into plugin data. */
  translation: string;
  /** Optional plural flag; falls back to existing plugin data when omitted. */
  isPlural?: boolean;
  pluralParamValue?: string;
  paramsValues?: Record<string, string>;
  key?: string;
  ns?: string;
  connected?: boolean;
};

/**
 * Pull-side counterpart to `setNodesData`. For each update we:
 *   1. resolve the node via the async API (dynamic-page safe),
 *   2. load every font present in the existing text and write `text`,
 *   3. persist the raw `translation` (and optional `isPlural`) into plugin
 *      data so future diffs work off the canonical source.
 *
 * The function never throws — per-node failures are collected into `errors`
 * so the UI can report them without aborting the whole batch.
 */
export const applyTranslations = async (
  updates: ApplyTranslationUpdate[],
): Promise<{ ok: boolean; errors: string[]; nodes: NodeInfo[] }> => {
  const errors: string[] = [];
  const nodes: NodeInfo[] = [];
  let processed = 0;

  for (const update of updates) {
    try {
      const node = await figma.getNodeByIdAsync(update.id);
      if (!node || node.type !== "TEXT") {
        errors.push(`Node ${update.id} is not a text node`);
        continue;
      }
      await writeTextNode(node, update.text);
      const partial: Partial<NodeInfo> = { translation: update.translation };
      if (update.isPlural !== undefined) partial.isPlural = update.isPlural;
      if (update.pluralParamValue !== undefined) {
        partial.pluralParamValue = update.pluralParamValue;
      }
      if (update.paramsValues !== undefined) {
        partial.paramsValues = update.paramsValues;
      }
      if (update.key !== undefined) partial.key = update.key;
      if (update.ns !== undefined) partial.ns = update.ns;
      if (update.connected !== undefined) partial.connected = update.connected;
      nodes.push(setNodeInfo(node, partial));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Node ${update.id}: ${msg}`);
    }

    processed++;
    // Each update is a real canvas mutation (font loads + `characters`
    // relayout), so breathe every few nodes — 50 unbroken text rewrites was
    // hundreds of ms of canvas-thread blocking on real frames.
    if (processed % 10 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return { ok: errors.length === 0, errors, nodes };
};
