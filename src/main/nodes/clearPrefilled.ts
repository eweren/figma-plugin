import { TOLGEE_NODE_INFO } from "$shared/constants";

/** Yield to the event loop after this many cleared nodes so a heavily
 *  prefilled document can't freeze the canvas mid-clear. The candidate set is
 *  already engine-filtered (only nodes carrying our pluginData), so this rarely
 *  fires — it's a safety valve, not the common path. */
const YIELD_EVERY = 200;

/**
 * Clear the persisted key of every UNCONNECTED text node across the whole
 * document — the "undo" for auto-generated key names when the user turns
 * "Prefill key format" OFF. Without it, keys the prefill wrote to node
 * pluginData while the toggle was on would linger in the list and be re-offered
 * as new keys on push.
 *
 * Fast by construction: each page is searched with the engine-side
 * `findAllWithCriteria` pluginData filter (like `scanConnectedNodes`), so only
 * nodes that actually carry our data are examined — never a JS walk over every
 * layer, which is what the published plugin does and what would stall large
 * files. Each page is `loadAsync`-ed first, as `documentAccess: "dynamic-page"`
 * requires before touching a non-current page (mirrors `resetConfig`).
 *
 * Blunt on purpose, matching the published plugin: it also clears a manually
 * typed key on an unconnected node — pluginData can't distinguish an auto key
 * from a hand-typed one, and turning the toggle off means "I don't want
 * prefilled keys". Connected nodes (real Tolgee links) are never touched.
 *
 * Returns the number of nodes cleared (for the caller's logging / tests).
 */
export async function clearPrefilledKeys(): Promise<number> {
  let cleared = 0;
  for (const page of figma.root.children) {
    if (page.type !== "PAGE") continue;
    await page.loadAsync();
    const nodes = page.findAllWithCriteria({
      types: ["TEXT"],
      pluginData: { keys: [TOLGEE_NODE_INFO] },
    });
    for (const node of nodes) {
      const raw = node.getPluginData(TOLGEE_NODE_INFO);
      if (!raw) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      // Keep real Tolgee links, and skip nodes that have nothing to clear.
      if (data.connected) continue;
      if (!data.key) continue;
      node.setPluginData(TOLGEE_NODE_INFO, JSON.stringify({ ...data, key: "" }));
      cleared++;
      if (cleared % YIELD_EVERY === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  return cleared;
}
