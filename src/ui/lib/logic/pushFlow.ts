import type { FrameScreenshot, NodeInfo } from "$shared/types";
import type { TolgeeClient } from "$ui/lib/api/client";
import { fetchRemoteKeys } from "$ui/lib/api/keysByName";
import {
  type PushKeysResult,
  type RelatedKeyDto,
  type SimpleImportConflictResult,
  type SingleStepImportResolvableItemRequest,
  pushKeys,
  storeBigMeta,
} from "$ui/lib/api/push";
import type { components } from "$ui/lib/api/schema.generated";
import { uploadScreenshot } from "$ui/lib/api/screenshots";
import { applyTags } from "$ui/lib/api/tags";
import { textOfNode } from "./pushDiff";

/**
 * How the user resolved a translation conflict. Lives here (not in the
 * `.svelte` view) so plain TS modules can reference it without depending on
 * Svelte's compiler magic for type re-exports.
 */
export type PushConflictResolution = "OVERRIDE" | "KEEP" | "FORCE_OVERRIDE";

type KeyScreenshotDto = components["schemas"]["KeyScreenshotDto"];

export type PushContext = {
  client: TolgeeClient;
  apiUrl: string;
  apiKey: string;
  language: string;
  branch?: string;
  hasNamespacesEnabled: boolean;
};

export type CanonicalKeyState = {
  translation: string;
  isPlural: boolean;
};

export function canonicalKey(n: NodeInfo): string {
  return `${n.ns ?? ""}|${n.key}`;
}

export function resolutionKey(keyName: string, keyNamespace: string | undefined): string {
  return `${keyNamespace ?? ""}|${keyName}`;
}

/**
 * After a successful push, pull the same keys back so we can persist the
 * exact translation Tolgee owns plus the canonical plural flag. The next
 * diff then compares like-for-like — without this, Tolgee's own canonical
 * rewrites (e.g. shared suffix extraction across plural variants) show as
 * phantom diffs forever.
 */
export async function fetchCanonicalAfterPush(
  ctx: PushContext,
  nodes: NodeInfo[],
): Promise<Map<string, CanonicalKeyState>> {
  const result = new Map<string, CanonicalKeyState>();
  const keysToFetch = new Set(nodes.map((n) => n.key).filter(Boolean));
  if (keysToFetch.size === 0) return result;

  const filterNamespace = ctx.hasNamespacesEnabled
    ? Array.from(new Set(nodes.map((n) => n.ns ?? "")))
    : undefined;

  const fetched = await fetchRemoteKeys(ctx.client, {
    filterKeyName: Array.from(keysToFetch),
    filterNamespace,
    language: ctx.language,
    branch: ctx.branch,
  });
  for (const k of fetched) {
    const text = k.translations?.[ctx.language]?.text;
    if (typeof text !== "string") continue;
    result.set(`${k.keyNamespace ?? ""}|${k.keyName}`, {
      translation: text,
      isPlural: Boolean(k.keyIsPlural),
    });
  }
  return result;
}

/**
 * Build the `screenshots` array of the import payload for one local node.
 * Each captured screenshot's `keys` may reference multiple Figma layers; we
 * keep only those that match the (key, ns) we are pushing and record their
 * positions.
 */
function mapScreenshotsForNode(
  node: NodeInfo,
  screenshots: FrameScreenshot[],
  uploadedImageIdByScreenshot: Map<FrameScreenshot, number>,
): KeyScreenshotDto[] {
  const out: KeyScreenshotDto[] = [];
  for (const screenshot of screenshots) {
    const positions = screenshot.keys
      .filter((k) => k.key === node.key && (k.ns ?? "") === (node.ns ?? ""))
      .map((k) => ({ x: k.x, y: k.y, width: k.width, height: k.height }));
    if (positions.length === 0) continue;
    const uploadedImageId = uploadedImageIdByScreenshot.get(screenshot);
    if (uploadedImageId === undefined) continue;
    out.push({
      text: textOfNode(node),
      uploadedImageId,
      positions,
    });
  }
  return out;
}

export type BuildPayloadOptions = {
  ctx: PushContext;
  nodes: NodeInfo[];
  screenshots: FrameScreenshot[];
  uploadedImageIdByScreenshot: Map<FrameScreenshot, number>;
  resolutionFor?: (key: string, ns: string | undefined) => PushConflictResolution | undefined;
  /** Node ids whose translation is UNCHANGED vs the server. Their payload item
   *  carries screenshots but an empty `translations` — so the push never
   *  re-overrides an untouched (and possibly REVIEWED) translation. Matches the
   *  published plugin, which sends `translations: {}` for unchanged keys. */
  unchangedNodeIds?: Set<string>;
};

export function buildPayload(opts: BuildPayloadOptions): SingleStepImportResolvableItemRequest[] {
  const { ctx, nodes, screenshots, uploadedImageIdByScreenshot, resolutionFor } = opts;

  return nodes.map((node) => {
    const resolution = resolutionFor?.(node.key, node.ns);
    const text = textOfNode(node);
    const screenshotsForNode = mapScreenshotsForNode(
      node,
      screenshots,
      uploadedImageIdByScreenshot,
    );

    // `KEEP` (user chose to keep the server value on a conflict) OR an UNCHANGED
    // key -> omit translations (only updates screenshots/tags), never touching
    // the stored translation.
    const isUnchanged = opts.unchangedNodeIds?.has(node.id) ?? false;
    const translations =
      resolution === "KEEP" || isUnchanged
        ? {}
        : {
            [ctx.language]: {
              text,
              resolution: "OVERRIDE" as const,
            },
          };

    return {
      name: node.key,
      namespace: ctx.hasNamespacesEnabled ? node.ns || undefined : undefined,
      screenshots: screenshotsForNode,
      translations,
    } satisfies SingleStepImportResolvableItemRequest;
  });
}

export type ProgressEvent = {
  current: number;
  total: number;
  message: string;
};

export type UploadScreenshotsResult = {
  screenshots: FrameScreenshot[];
  uploadedById: Map<FrameScreenshot, number>;
};

/**
 * Upload a batch of frame screenshots sequentially. Sequential is the right
 * choice here: each request is large (multipart PNG) and Tolgee throttles
 * parallel uploads; the legacy plugin chained them too.
 */
export async function uploadScreenshots(
  ctx: PushContext,
  screenshots: FrameScreenshot[],
  onProgress: (event: ProgressEvent) => void,
): Promise<Map<FrameScreenshot, number>> {
  const uploadedById = new Map<FrameScreenshot, number>();
  onProgress({
    current: 0,
    total: screenshots.length,
    message: "Uploading screenshots…",
  });
  for (let i = 0; i < screenshots.length; i++) {
    const screenshot = screenshots[i];
    if (!screenshot) continue;
    const uploaded = await uploadScreenshot(ctx.apiUrl, ctx.apiKey, screenshot.image, {
      location: `figma-${screenshot.info.id}`,
    });
    uploadedById.set(screenshot, uploaded.id);
    onProgress({
      current: i + 1,
      total: screenshots.length,
      message: "Uploading screenshots…",
    });
  }
  return uploadedById;
}

export type SubmitPushOptions = {
  ctx: PushContext;
  nodes: NodeInfo[];
  screenshots: FrameScreenshot[];
  uploadedImageIdByScreenshot: Map<FrameScreenshot, number>;
  resolutionMode: "RECOMMENDED" | "FORCE_OVERRIDE";
  resolutionFor?: BuildPayloadOptions["resolutionFor"];
  unchangedNodeIds?: Set<string>;
};

export async function submitPush(opts: SubmitPushOptions): Promise<PushKeysResult> {
  const payload = buildPayload({
    ctx: opts.ctx,
    nodes: opts.nodes,
    screenshots: opts.screenshots,
    uploadedImageIdByScreenshot: opts.uploadedImageIdByScreenshot,
    resolutionFor: opts.resolutionFor,
    unchangedNodeIds: opts.unchangedNodeIds,
  });
  return pushKeys(opts.ctx.client, payload, {
    branch: opts.ctx.branch || undefined,
    resolutionMode: opts.resolutionMode,
    errorOnUnresolvedConflict: false,
  });
}

/** The `relatedKeysInOrder` for one screenshot: the keys it contains, in the
 *  order captured, capped at 100 (matching the original plugin). */
export function buildRelatedKeys(
  ctx: PushContext,
  screenshot: FrameScreenshot,
): RelatedKeyDto[] {
  return screenshot.keys
    .filter((k) => k.key)
    .map((k) => ({
      keyName: k.key,
      namespace: ctx.hasNamespacesEnabled ? k.ns || undefined : undefined,
      branch: ctx.branch || undefined,
    }))
    .slice(0, 100);
}

/**
 * Registers screenshot key-context ("related keys in order") with Tolgee via
 * `POST /v2/projects/big-meta`, once per screenshot — feeding Tolgee's
 * in-context translation suggestions, like the original plugin. Best-effort:
 * the translations are already saved, so a failure here is swallowed and never
 * fails the push. Runs the (lightweight, image-free) calls concurrently.
 */
export async function submitBigMeta(
  ctx: PushContext,
  screenshots: FrameScreenshot[],
): Promise<void> {
  await Promise.allSettled(
    screenshots
      .map((s) => buildRelatedKeys(ctx, s))
      .filter((keys) => keys.length > 0)
      .map((keys) => storeBigMeta(ctx.client, keys)),
  );
}

export type ApplyTagsOptions = {
  ctx: PushContext;
  tags: string[];
  nodes: NodeInfo[];
};

export async function applyConfiguredTags(opts: ApplyTagsOptions): Promise<void> {
  if (opts.tags.length === 0) return;
  await applyTags(
    opts.ctx.client,
    opts.tags,
    opts.nodes.map((n) => ({
      name: n.key,
      namespace: opts.ctx.hasNamespacesEnabled ? n.ns || undefined : undefined,
    })),
    opts.ctx.branch || undefined,
  );
}

/**
 * Build the default conflict-resolution map (override when allowed, keep
 * otherwise). The caller mutates this map as the user picks alternatives.
 */
export function defaultResolutions(
  list: SimpleImportConflictResult[],
): Record<string, PushConflictResolution> {
  const next: Record<string, PushConflictResolution> = {};
  for (const c of list) {
    next[resolutionKey(c.keyName, c.keyNamespace)] = c.isOverridable ? "OVERRIDE" : "KEEP";
  }
  return next;
}
