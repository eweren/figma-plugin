import type { NodeInfo } from "$shared/types";
import type { PulledKey } from "$ui/lib/api/pull";
import { renderIcuForNode } from "$shared/interpolate";
import { plainCanvasText } from "$shared/richText";

export type PullDiffResult = {
  /** Nodes whose remote translation differs from the local `translation`. */
  changedNodes: Array<{ node: NodeInfo; newText: string; isPlural: boolean }>;
  /** Connected nodes whose key is not present in the remote payload. */
  missingKeys: NodeInfo[];
  /** Connected nodes whose remote translation matches the local one. */
  unchangedNodes: NodeInfo[];
};

/**
 * Builds a lookup table of `ns|key` -> remote key. We index by namespace +
 * keyName because Tolgee allows the same key name across namespaces.
 *
 * Empty namespace and `undefined` namespace both map to `""` so lookup is
 * consistent regardless of whether the server omits the field.
 */
function indexRemote(remoteKeys: PulledKey[]): Map<string, PulledKey> {
  const map = new Map<string, PulledKey>();
  for (const k of remoteKeys) {
    const ns = k.keyNamespace ?? "";
    map.set(`${ns}|${k.keyName}`, k);
  }
  return map;
}

/**
 * Compute the pull diff between local connected nodes and the remote
 * translations payload, for a single `language`.
 *
 * This deliberately compares raw text only — no ICU formatting is applied
 * here. Callers that need the final TextNode characters should run
 * `formatNodeText` per changed node afterwards (and surface the formatting
 * error to the user if any).
 *
 * Nodes that aren't connected to a key are ignored — they have nothing to
 * pull. Connected nodes without a remote key land in `missingKeys`.
 */
/**
 * Whether the canvas characters differ from what applying `remoteText` would
 * ACTUALLY write. The comparison must run the remote text through the same
 * pipeline the apply path uses — ICU render (quote unescaping, param
 * seeding), then the shared `plainCanvasText` markup strip (`<b>` becomes a
 * font range, not characters; `<br>` becomes "\n") — because comparing the
 * canvas against the RAW remote text made every formatted string look
 * permanently drifted and re-download as "changed" on every single pull.
 *
 * A render failure counts as "no drift": we can't know what the canvas
 * should look like, and re-applying on unknowns would loop forever too.
 */
function canvasDrifted(node: NodeInfo, remoteText: string, language: string): boolean {
  const out = renderIcuForNode(remoteText, node, language);
  if (out.error) return false;
  return node.characters !== plainCanvasText(out.text);
}

export function pullDiff(
  localNodes: NodeInfo[],
  remoteKeys: PulledKey[],
  language: string,
): PullDiffResult {
  const remote = indexRemote(remoteKeys);

  const changedNodes: PullDiffResult["changedNodes"] = [];
  const missingKeys: NodeInfo[] = [];
  const unchangedNodes: NodeInfo[] = [];

  for (const node of localNodes) {
    if (!node.connected || !node.key) continue;

    const ns = node.ns ?? "";
    const remoteKey = remote.get(`${ns}|${node.key}`);

    if (!remoteKey) {
      missingKeys.push(node);
      continue;
    }

    const remoteText = remoteKey.translations[language]?.text ?? "";
    const remoteIsPlural = remoteKey.isPlural;

    // Treat an empty remote translation the same way the legacy plugin did:
    // surface it as "missing" so the user sees they need to translate the
    // key in Tolgee. Overwriting a local string with `""` would be
    // destructive, so we don't fall into the changedNodes bucket either.
    if (!remoteText) {
      missingKeys.push(node);
      continue;
    }

    if (remoteText !== node.translation || remoteIsPlural !== Boolean(node.isPlural)) {
      changedNodes.push({
        node,
        newText: remoteText,
        isPlural: remoteIsPlural,
      });
    } else if (
      // The cached translation matches the remote, but the rendered canvas
      // characters have drifted (e.g. someone typed over the layer manually).
      // For non-plural / non-parametric keys we can safely re-apply the
      // remote text so the canvas matches the source of truth again.
      // Skip if `characters` is empty — that's not real drift, it just means
      // the node hasn't been rendered yet (typical in tests / fresh syncs).
      node.characters &&
      !remoteIsPlural &&
      !node.isPlural &&
      (!node.paramsValues || Object.keys(node.paramsValues).length === 0) &&
      canvasDrifted(node, remoteText, language)
    ) {
      changedNodes.push({
        node,
        newText: remoteText,
        isPlural: remoteIsPlural,
      });
    } else {
      unchangedNodes.push(node);
    }
  }

  return { changedNodes, missingKeys, unchangedNodes };
}

/**
 * Renders the final string that will land in `TextNode.characters` for a
 * single pulled translation, via the shared render core (`renderIcuForNode`).
 * For a plural, the variable's sample COUNT comes from the node (so each layer
 * keeps its own form — "1 woman" / "10 women"), the variable NAME from the ICU,
 * and any other named param is seeded with its own name so nothing renders as a
 * literal `{brace}`.
 *
 * On a formatting error, keeps the node's CURRENT canvas text (never dumps raw
 * ICU onto the design) and returns the captured `Error` so the caller can warn
 * — matching the original pull behaviour.
 */
export function formatNodeText(
  node: NodeInfo,
  remoteText: string,
  language: string,
): { text: string; error?: Error } {
  const out = renderIcuForNode(remoteText, node, language);
  return out.error ? { text: node.characters, error: out.error } : out;
}
