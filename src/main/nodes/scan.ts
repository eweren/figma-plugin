import { TOLGEE_NODE_INFO } from "$shared/constants";

/**
 * Load the current page (no-op if already loaded) and return every `TextNode`
 * on it. Uses `findAllWithCriteria`, which short-circuits inside the Figma
 * runtime instead of recursing through every child in the JS bridge.
 */
export const scanCurrentPageTextNodes = async (): Promise<TextNode[]> => {
  await figma.currentPage.loadAsync();
  // TODO: for very large pages we may want to yield to the event loop here
  // (e.g. via `setTimeout`/`requestAnimationFrame`) once we have telemetry.
  return figma.currentPage.findAllWithCriteria({ types: ["TEXT"] });
};

/**
 * Return only the text nodes on the current page that carry our plugin data
 * key. The `pluginData.keys` filter is a 2024 addition to the Plugin API and
 * works with `api: 1.0.0` + `documentAccess: "dynamic-page"`, which is what
 * this plugin targets.
 */
export const scanConnectedNodes = async (): Promise<TextNode[]> => {
  await figma.currentPage.loadAsync();
  // TODO: yield periodically for huge documents once measurement exists.
  return figma.currentPage.findAllWithCriteria({
    types: ["TEXT"],
    pluginData: { keys: [TOLGEE_NODE_INFO] },
  });
};

/** A scanned text node plus whether any ANCESTOR within the scanned selection
 *  is hidden — computed once during traversal (threaded down), so the ignore
 *  filter never has to walk each node's parent chain (matches the original
 *  plugin's `ancestorHidden` approach; the per-node walk was "expensive"). */
export type ScannedTextNode = { node: TextNode; ancestorHidden: boolean };

// The plugin sandbox and the Figma canvas share scheduling — a long
// uninterrupted walk over a huge subtree freezes the whole editor. Yielding
// to the event loop every couple hundred visited nodes keeps Figma responsive
// while costing nothing on small selections (no yield ever fires).
const YIELD_EVERY = 200;

const collectTextNodes = async (
  node: SceneNode,
  out: ScannedTextNode[],
  ancestorHidden: boolean,
  progress: { visited: number },
  isStale: () => boolean,
): Promise<void> => {
  progress.visited++;
  if (progress.visited % YIELD_EVERY === 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (isStale()) return;
  }
  if (node.type === "TEXT") {
    out.push({ node, ancestorHidden });
    return;
  }
  if ("children" in node) {
    // A container's own hidden state makes its whole subtree "ancestor-hidden".
    const childAncestorHidden = ancestorHidden || node.visible === false;
    for (const child of node.children) {
      if (isStale()) return;
      await collectTextNodes(child, out, childAncestorHidden, progress, isStale);
    }
  }
};

/**
 * Walk the current selection and return every reachable `TextNode`, each tagged
 * with whether an ancestor inside the selection is hidden. Containers (frames,
 * groups, components, instances, …) are descended into so the user can select
 * an arbitrary subtree and still get all its text nodes back.
 *
 * Two strategies:
 * - FAST (default): `findAllWithCriteria` per selection root. The traversal
 *   runs inside the Figma engine — the JS side never touches the (often tens
 *   of thousands of) vector/shape nodes a design section contains, so a
 *   100-key section costs ~100 bridge crossings instead of ~100k. Usable
 *   whenever `ancestorHidden` isn't needed.
 * - RECURSIVE: JS walk that threads `ancestorHidden` down — required only for
 *   the opt-in "ignore hidden layers including children" filter, which needs
 *   to know whether any ancestor within the selection is hidden.
 */
export const scanSelectedTextNodes = async (
  needsAncestorHidden: boolean,
  // Superseded-scan check, polled at every yield. A newer selection makes the
  // running scan WORTHLESS — without bailing out it would keep burning canvas
  // time in the background, and rapid selection switches after a large
  // selection queued up "zombie" scans the new one had to wait behind.
  isStale: () => boolean = () => false,
): Promise<ScannedTextNode[]> => {
  // `figma.currentPage` is implicitly loaded — selection access requires it —
  // but calling `loadAsync` again is cheap and keeps the contract explicit.
  await figma.currentPage.loadAsync();
  const out: ScannedTextNode[] = [];

  if (!needsAncestorHidden) {
    let roots = 0;
    for (const node of figma.currentPage.selection) {
      if (isStale()) return out;
      if (node.type === "TEXT") {
        out.push({ node, ancestorHidden: false });
      } else if ("findAllWithCriteria" in node) {
        const found = node.findAllWithCriteria({ types: ["TEXT"] });
        for (const text of found) {
          out.push({ node: text, ancestorHidden: false });
        }
      }
      // The per-root search runs engine-side; a periodic breather between
      // roots covers multi-container selections without taxing the common
      // "hundreds of individually selected texts" case with per-root hops.
      roots++;
      if (roots % 25 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    return out;
  }

  const progress = { visited: 0 };
  for (const node of figma.currentPage.selection) {
    if (isStale()) return out;
    await collectTextNodes(node, out, false, progress, isStale);
  }
  return out;
};
