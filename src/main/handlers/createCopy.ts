import { TOLGEE_NODE_INFO, TOLGEE_PLUGIN_CONFIG_NAME } from "$shared/constants";

import { send } from "$main/bus";
import { getNodeInfo } from "$main/nodes/getNodeInfo";
import { loadFontCached } from "$main/text/applyRichText";

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
       * Map of language tag -> map of `${ns}|${key}` -> translation text.
       * The UI is responsible for assembling this from the Tolgee API.
       */
      translations: Record<string, Record<string, string>>;
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
          await writeTextSafely(node, label);
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
            const text = translationsForLang[lookupKey] ?? info.translation;
            if (text) {
              await writeTextSafely(node, text);
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
 * Write `text` into `node.characters` after loading every font range present
 * in the existing text. Bails out silently when the node has missing fonts or
 * mixed fonts — those cases are very rare on connected nodes (writeTextNode
 * elsewhere has the same shape) and would otherwise abort the whole copy.
 */
async function writeTextSafely(node: TextNode, text: string): Promise<void> {
  if (node.hasMissingFont) return;

  const length = node.characters.length;
  if (length === 0) {
    // Range APIs throw on an empty node ((0,1) is out of bounds) — and an
    // uncaught throw here used to abort the WHOLE copy. Load the node's
    // single font instead.
    const font = node.fontName;
    if (font === figma.mixed) return;
    await loadFontCached(font);
  } else {
    const fonts = node.getRangeAllFontNames(0, length);
    // Session-cached — language copies rewrite the same font set page after
    // page; only the first page pays the actual loads.
    await Promise.all(fonts.map((f) => loadFontCached(f)));
  }

  if (node.fontName === figma.mixed) return;

  node.autoRename = false;
  node.characters = text;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
