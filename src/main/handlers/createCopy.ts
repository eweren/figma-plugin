import { TOLGEE_NODE_INFO, TOLGEE_PLUGIN_CONFIG_NAME } from "$shared/constants";
import { renderIcuForNode } from "$shared/interpolate";
import type { NodeInfo } from "$shared/types";

import { send } from "$main/bus";
import { getNodeInfo } from "$main/nodes/getNodeInfo";
import { applyRichText } from "$main/text/applyRichText";

/**
 * Options for the `createCopy` handler. The two modes have different payloads
 * but share a `correlationId` so the UI can pair its `create-copy` request
 * with the `create-copy-result` it receives back.
 */
export type CreateCopyOptions =
  | { mode: "keys"; correlationId: string }
  | {
      mode: "languages";
      correlationId: string;
      languages: string[];
      /**
       * Map of language tag -> map of `${ns}|${key}` -> the key's raw
       * translation + its `isPlural` flag (a per-KEY Tolgee property, so it's
       * trusted over the copied node's own possibly-stale `isPlural`). The UI
       * is responsible for assembling this from the Tolgee API.
       */
      translations: Record<string, Record<string, { text: string; isPlural: boolean }>>;
    };

export type CreateCopyResult = {
  ok: boolean;
  createdPageIds: string[];
  error?: string;
};

/**
 * How often to emit a progress message + yield to the event loop while
 * iterating large text-node lists. Keeps the plugin sandbox responsive
 * during long-running operations on big pages.
 */
const PROGRESS_INTERVAL = 10;

/**
 * Clone the current page and rewrite every connected text node:
 *
 * - `mode: "keys"` replaces each connected text node's `characters` with the
 *   Tolgee key (prefixed with the namespace when one is set) so the page can
 *   be used as a debug overlay.
 * - `mode: "languages"` clones the page once per language and writes the
 *   provided translation (looked up by `${ns}|${key}`) into every connected
 *   text node. Falls back to the persisted `translation` for any miss so the
 *   page never ends up empty.
 *
 * Every cloned page is marked with `pageCopy: true` in plugin data so the UI
 * routes to the read-only `CopyView` when the user navigates to it. Before each
 * clone, a previous copy with the SAME name (and only one marked `pageCopy`) is
 * removed so repeated copies replace rather than pile up — matching the original
 * plugin.
 *
 * Progress is reported via `create-copy-progress` messages keyed by the
 * caller's `correlationId`.
 */
export async function createCopy(options: CreateCopyOptions): Promise<CreateCopyResult> {
  const sourcePage = figma.currentPage;
  await sourcePage.loadAsync();

  const createdPageIds: string[] = [];

  try {
    if (options.mode === "keys") {
      // Matches production's naming exactly (`${name} - keys`, hyphen +
      // lowercase) — `removeExistingCopyPages` below replaces a previous copy
      // by EXACT name match, so a mismatched format (e.g. an em dash or
      // capitalized "Keys") would never find/replace a copy the production
      // plugin created, and vice versa, letting copies pile up instead.
      const targetName = `${sourcePage.name} - keys`;
      await removeExistingCopyPages(targetName);
      const targetPage = sourcePage.clone();
      targetPage.name = targetName;
      figma.root.appendChild(targetPage);
      createdPageIds.push(targetPage.id);

      await targetPage.loadAsync();
      // pluginData filter: only Tolgee-tagged nodes come back, so untagged
      // text (usually most of the page) never pays the 5-bridge-call
      // `getNodeInfo` just to be skipped.
      const textNodes = targetPage.findAllWithCriteria({
        types: ["TEXT"],
        pluginData: { keys: [TOLGEE_NODE_INFO] },
      });
      const total = textNodes.length;
      let processed = 0;

      for (const node of textNodes) {
        const info = getNodeInfo(node);
        if (info.connected && info.key) {
          const label = info.ns ? `${info.ns}.${info.key}` : info.key;
          await writeTextSafely(node, label, { plainOnly: true });
        }
        processed++;
        if (processed % PROGRESS_INTERVAL === 0) {
          send({
            type: "create-copy-progress",
            correlationId: options.correlationId,
            current: processed,
            total,
            phase: "writing-keys",
          });
          await yieldToEventLoop();
        }
      }

      markPageAsCopy(targetPage);
    } else {
      // mode === "languages"
      const totalPages = options.languages.length;

      for (let i = 0; i < totalPages; i++) {
        const lang = options.languages[i];
        if (!lang) continue;

        // Matches production's naming exactly — see the "keys" branch above.
        const targetName = `${sourcePage.name} - ${lang}`;
        await removeExistingCopyPages(targetName);
        const targetPage = sourcePage.clone();
        targetPage.name = targetName;
        figma.root.appendChild(targetPage);
        createdPageIds.push(targetPage.id);

        await targetPage.loadAsync();
        const textNodes = targetPage.findAllWithCriteria({
          types: ["TEXT"],
          pluginData: { keys: [TOLGEE_NODE_INFO] },
        });
        const translationsForLang = options.translations[lang] ?? {};

        const total = textNodes.length;
        let processed = 0;

        for (const node of textNodes) {
          const info = getNodeInfo(node);
          if (info.connected && info.key) {
            // Translations are keyed by `${ns}|${key}` on the UI side because
            // the cloned node has a different `id` than the source node.
            const lookupKey = `${info.ns ?? ""}|${info.key}`;
            const resolved = resolveCopyNodeText(info, translationsForLang[lookupKey], lang);
            if (resolved !== null) {
              await writeTextSafely(node, resolved);
            }
          }
          processed++;
          if (processed % PROGRESS_INTERVAL === 0) {
            const overall = i * 100 + Math.round((processed / Math.max(total, 1)) * 100);
            send({
              type: "create-copy-progress",
              correlationId: options.correlationId,
              current: overall,
              total: totalPages * 100,
              phase: `writing-${lang}`,
            });
            await yieldToEventLoop();
          }
        }

        markPageAsCopy(targetPage, lang);
      }
    }

    return { ok: true, createdPageIds };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, createdPageIds, error };
  }
}

/** Whether a page is a previously-generated Tolgee copy (marked `pageCopy`). */
function isCopyPage(page: PageNode): boolean {
  const raw = page.getPluginData(TOLGEE_PLUGIN_CONFIG_NAME);
  if (!raw) return false;
  try {
    return (JSON.parse(raw) as { pageCopy?: boolean }).pageCopy === true;
  } catch {
    return false;
  }
}

/**
 * Remove any existing copy page with the given name, so a repeated copy
 * replaces the old one instead of accumulating duplicates. Only pages marked
 * `pageCopy: true` are removed — a user's own same-named page is left alone
 * (matches the original plugin). Only pages whose name matches are loaded, so
 * this doesn't force-load the whole document under dynamic-page access.
 */
export async function removeExistingCopyPages(name: string): Promise<void> {
  for (const page of figma.root.children) {
    if (page.type !== "PAGE" || page.name !== name) continue;
    await page.loadAsync();
    if (isCopyPage(page)) page.remove();
  }
}

/**
 * The text to write for one connected node in a language copy: the remote
 * translation for its key (falling back to the node's own persisted
 * `translation` on a miss, so the page never ends up empty), rendered
 * through THIS node's own plural/param samples — same as the regular Pull
 * flow — instead of writing the raw ICU pattern verbatim. `isPlural` comes
 * from the remote key when available (a per-KEY Tolgee property) since it's
 * more trustworthy than the copied node's own possibly-stale flag.
 *
 * Returns `null` when there's nothing to write (no remote match and no
 * persisted translation) — the caller leaves the node as cloned.
 */
export function resolveCopyNodeText(
  info: NodeInfo,
  remote: { text: string; isPlural: boolean } | undefined,
  language: string,
): string | null {
  const rawText = remote?.text ?? info.translation;
  if (!rawText) return null;
  const isPlural = remote?.isPlural ?? info.isPlural;
  return renderIcuForNode(rawText, { ...info, isPlural }, language).text;
}

/**
 * Write plugin data onto a freshly cloned page so the UI shows the read-only
 * `CopyView`. Skips `writeConfig` so we don't leak the marker into the
 * global/document scopes.
 */
function markPageAsCopy(page: PageNode, language?: string): void {
  const payload: Record<string, unknown> = {
    pageCopy: true,
    pageInfo: true,
  };
  if (language) {
    payload.language = language;
  }
  page.setPluginData(TOLGEE_PLUGIN_CONFIG_NAME, JSON.stringify(payload));
}

/**
 * Write `text` into `node` via the shared rich-text applier (bold/italic/
 * underline from inline HTML tags, same as the regular Pull/apply-
 * translations path) — bails out silently when the node has missing or
 * mixed fonts, which are very rare on connected nodes and would otherwise
 * abort the whole copy.
 */
async function writeTextSafely(
  node: TextNode,
  text: string,
  options?: { plainOnly?: boolean },
): Promise<void> {
  if (node.hasMissingFont) return;
  if (node.fontName === figma.mixed) return;
  await applyRichText(node, text, options);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
