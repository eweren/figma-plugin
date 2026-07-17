import { renderIcuForNode } from "$shared/interpolate";
import type { UiToMain } from "$shared/messages";
import type { NodeInfo } from "$shared/types";
import { nextCorrelationId, on, send } from "$ui/lib/bus";
import { createIdleTimeout } from "$ui/lib/busRequest";

/**
 * UI half of the language-copy flow. The main thread only CLONES the page and
 * returns its connected nodes (`create-copy-result.pages`) — it can't render
 * ICU itself, Figma's main-thread sandbox has no `Intl` (plural rules), so
 * every `{param}`/plural render silently failed there and copies came out
 * half in the source language. This module renders each node exactly like
 * the Download flow and writes the results back through the ordinary
 * `apply-translations` request, which also persists the raw `translation`
 * into plugin data — making a fresh copy identical to clone + Download all
 * (an immediate Download afterwards reports "No changes found").
 */

export type CopyTranslations = Record<string, { text: string; isPlural: boolean }>;

type ApplyUpdate = Extract<UiToMain, { type: "apply-translations" }>["updates"][number];

/**
 * The text to write for each connected node of a fresh language copy: the
 * remote translation for its key (falling back to the node's own persisted
 * `translation` on a miss, so the page never ends up empty), rendered through
 * THIS node's own plural/param samples — same pipeline as the regular
 * Download. `isPlural` comes from the remote key when available (a per-KEY
 * Tolgee property) since it's more trustworthy than the cloned node's own
 * possibly-stale flag.
 *
 * Nodes with nothing to write (no remote match and no persisted translation)
 * or an unrenderable ICU are skipped — the clone keeps its source-language
 * text rather than getting raw ICU dumped onto the canvas.
 */
export function buildCopyUpdates(
  nodes: NodeInfo[],
  translationsForLang: CopyTranslations,
  language: string,
): ApplyUpdate[] {
  const updates: ApplyUpdate[] = [];
  for (const node of nodes) {
    if (!node.connected || !node.key) continue;
    const remote = translationsForLang[`${node.ns ?? ""}|${node.key}`];
    const rawText = remote?.text ?? node.translation;
    if (!rawText) continue;
    const isPlural = remote?.isPlural ?? node.isPlural;
    const out = renderIcuForNode(rawText, { ...node, isPlural }, language);
    if (out.error) continue;
    updates.push({ id: node.id, text: out.text, translation: rawText, isPlural });
  }
  return updates;
}

// Same idle-timeout rationale as CopyView's own apply watchdog: progress
// messages keep resetting the clock, so only a genuinely silent write trips
// it — large pages legitimately take a while between pings.
const APPLY_TIMEOUT_MS = 5 * 60_000;

/**
 * Send one `apply-translations` batch and resolve with its result. Mirrors
 * `requestPageConnectedNodes`' promise-wrapper shape (correlation id pairing,
 * idle watchdog touched by progress). `onProgress` forwards the write's
 * done/total (only emitted by the main thread for batches > 100 nodes).
 */
export function applyTranslationsRequest(
  updates: ApplyUpdate[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: boolean; errors: string[] }> {
  return new Promise((resolve) => {
    const correlationId = nextCorrelationId();
    const cleanup = (): void => {
      offResult();
      offProgress();
      watchdog.clear();
    };
    const watchdog = createIdleTimeout(APPLY_TIMEOUT_MS, () => {
      cleanup();
      resolve({ ok: false, errors: ["Timed out waiting for the translations to apply."] });
    });
    const offResult = on("apply-translations-result", (msg) => {
      if (msg.correlationId !== correlationId) return;
      cleanup();
      resolve({ ok: msg.ok, errors: msg.errors });
    });
    const offProgress = on("apply-translations-progress", (msg) => {
      if (msg.correlationId !== correlationId) return;
      watchdog.touch();
      onProgress?.(msg.done, msg.total);
    });
    send({ type: "apply-translations", correlationId, updates });
  });
}

/**
 * Render + apply the translations onto every freshly cloned page, one
 * `apply-translations` batch per page. Pages whose nodes all resolve to
 * "nothing to write" are skipped without a round-trip. Stops at the first
 * failing page and reports its first error — matching how the copy result
 * itself is surfaced (one error message, not a per-node report).
 */
export async function applyCopyPages(
  pages: Array<{ pageId: string; language: string; nodes: NodeInfo[] }>,
  translationsByLang: Record<string, CopyTranslations>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: boolean; error?: string }> {
  for (const page of pages) {
    const updates = buildCopyUpdates(
      page.nodes,
      translationsByLang[page.language] ?? {},
      page.language,
    );
    if (updates.length === 0) continue;
    const result = await applyTranslationsRequest(updates, onProgress);
    if (!result.ok) {
      return { ok: false, error: result.errors[0] ?? "Failed to write the copy's translations." };
    }
  }
  return { ok: true };
}
