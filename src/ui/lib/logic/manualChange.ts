import type { NodeInfo } from "$shared/types";
import { translationDiffersFromNodeCached } from "$ui/lib/logic/interpolate";

/**
 * Detection for the "manual changes detected" conflict — an ADVANCED connected
 * string (plural / params / markup) whose stored translation no longer matches
 * the Figma canvas, i.e. it was edited directly in Figma and its formatting was
 * lost. Purely read-only UI logic; never touches main thread / pushDiff.
 *
 * Deliberately ADVANCED-only: a plain connected string edited in Figma is just a
 * normal "changed" push (the old plugin treats it that way), so flagging it only
 * adds friction. Plain edits are NOT flagged.
 */

// Inline HTML markup we render (b/i/u/strong/em) or an ICU argument like
// `{count}` / `{count, plural, …}` — formatting a plain Figma edit would drop.
const ADVANCED_MARKUP = /<\/?(?:b|i|u|strong|em)\b|\{[^}]*\}/i;

/**
 * Does this string rely on advanced ICU / formatting features (plural, params,
 * or inline markup)?
 */
export function isAdvancedString(node: NodeInfo): boolean {
  if (node.isPlural) return true;
  if (node.paramsValues && Object.keys(node.paramsValues).length > 0) return true;
  return ADVANCED_MARKUP.test(node.translation ?? "");
}

export function hasManualChange(node: NodeInfo, language: string): boolean {
  // Any ADVANCED string (plural / params / markup) whose canvas text diverges
  // from its rendered stored translation — connected or NOT, matching the
  // published plugin, which shows the warning + "Revert" regardless of link
  // state (`NodeRow` / `StringDetails` gate purely on `translationDiffersFromNode`).
  // That render/compare is a no-op for "simple" strings, so plain edits aren't
  // flagged (they're a normal "changed" push), and a string with no stored
  // translation has nothing to diverge from.
  if (!(node.translation ?? "")) return false;
  return translationDiffersFromNodeCached(node, language);
}
