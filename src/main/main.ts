import { attachBus, on, send } from "$main/bus";
import {
  cancelReconcile,
  clearCurrentPage,
  isAnnotationsEnabled,
  scheduleReconcile,
  setAnnotationsEnabled,
  syncCurrentPage,
} from "$main/handlers/annotations";
import { createCopy } from "$main/handlers/createCopy";
import { applyTranslations } from "$main/nodes/selection";
import { getNodeInfo } from "$main/nodes/getNodeInfo";
import { cleanUpHighlights, highlightNode } from "$main/nodes/highlight";
import { scanConnectedNodes } from "$main/nodes/scan";
import { type MainComponentNameCache, resolveParentNames } from "$main/nodes/nodeParents";
import { type KeyParentNames, keyFormatUsesParents } from "$shared/keyFormat";
import type { NodeInfo } from "$shared/types";
import { getSelectionInfo, setNodesData } from "$main/nodes/selection";
import { captureScreenshots } from "$main/screenshots/capture";
import {
  invalidateConfigCache,
  readMergedConfig,
  resetConfig,
  writeConfig,
} from "$main/settings";
import { UI_SIZES } from "$shared/constants";

// When the manifest's `ui` is a string, Figma injects `__html__`. When it's
// an object (per-editor UIs), Figma injects `__uiFiles__` instead with one
// entry per editor key. We picked the object form (figma + dev) so we have
// to read from `__uiFiles__` here. `__html__` is only used as a fallback if
// neither global is available (shouldn't happen but keeps TypeScript calm).
declare const __uiFiles__: { figma?: string; dev?: string } | undefined;
declare const __html__: string | undefined;

const uiHtml =
  figma.editorType === "dev"
    ? (__uiFiles__?.dev ?? __uiFiles__?.figma ?? __html__ ?? "")
    : (__uiFiles__?.figma ?? __html__ ?? "");

figma.skipInvisibleInstanceChildren = true;

// Quick-action commands run their side effect and close the plugin without
// ever showing the UI. Everything else opens the plugin window.
const isQuickAction = figma.command === "toggle-annotations" && figma.editorType !== "dev";

if (isQuickAction) {
  void (async () => {
    try {
      const enabled = !(await isAnnotationsEnabled());
      await setAnnotationsEnabled(enabled);
      if (enabled) {
        const { updated } = await syncCurrentPage();
        figma.closePlugin(`Tolgee annotations on (${updated} updated)`);
      } else {
        const { updated } = await clearCurrentPage();
        figma.closePlugin(`Tolgee annotations off (${updated} cleared)`);
      }
    } catch (err) {
      figma.closePlugin(`Tolgee error: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
} else {
  figma.showUI(uiHtml, {
    width: UI_SIZES.DEFAULT.width,
    height: UI_SIZES.DEFAULT.height,
    themeColors: true,
  });
  attachBus();
}

// Cached annotation-toggle state. The truth lives in clientStorage; this is
// the in-memory mirror that lets synchronous Figma event handlers
// (selectionchange / documentchange) avoid an async hop on every tick.
let annotationsEnabled = false;

async function refreshAnnotationsEnabled(): Promise<void> {
  annotationsEnabled = await isAnnotationsEnabled();
}

// Monotonic token: each new scan invalidates every scan still in flight, so a
// slow older scan can never overwrite a newer selection in the UI.
let scanGeneration = 0;

async function emitSelection(sendPending = true): Promise<void> {
  const generation = ++scanGeneration;
  // Tell the UI a scan is starting so it can show a loader during the
  // (potentially slow) getSelectionInfo() below, not just after it resolves.
  if (sendPending) send({ type: "selection-pending" });
  let nodes: Awaited<ReturnType<typeof getSelectionInfo>>["nodes"] = [];
  try {
    nodes = (await getSelectionInfo()).nodes;
  } catch (err) {
    // A failed scan MUST still answer the pending signal — otherwise the UI's
    // delayed spinner (armed by `selection-pending`) stays up forever. Fall
    // through and send an empty list; the next selection change recovers.
    console.warn("[tolgee:main] selection scan failed", err);
  }
  if (generation !== scanGeneration) return; // superseded by a newer scan
  send({
    type: "selection-changed",
    nodes,
    hasUserSelection: figma.currentPage.selection.length > 0,
  });
}

// Selection events come in two shapes: a single deliberate click, and rapid
// bursts (arrow-keying / drag-selecting through layers fires one event per
// step). A deliberate click scans IMMEDIATELY — a fixed delay on every click
// reads as sluggishness against the previous plugin. Only events that follow
// each other closely (a burst) are coalesced with a short trailing debounce;
// the scan generation token drops any older in-flight result either way.
const SELECTION_BURST_MS = 150;
const SELECTION_DEBOUNCE_MS = 60;
let selectionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastSelectionChangeAt = 0;

function scheduleEmitSelection(): void {
  send({ type: "selection-pending" });
  const now = Date.now();
  const inBurst = now - lastSelectionChangeAt < SELECTION_BURST_MS;
  lastSelectionChangeAt = now;
  if (selectionDebounceTimer) clearTimeout(selectionDebounceTimer);
  if (!inBurst) {
    void emitSelection(false);
    return;
  }
  selectionDebounceTimer = setTimeout(() => {
    selectionDebounceTimer = null;
    void emitSelection(false);
  }, SELECTION_DEBOUNCE_MS);
}

async function emitPageChange(): Promise<void> {
  const config = await readMergedConfig();
  send({ type: "page-changed", config });
  await emitSelection();
}

// --- Figma event subscriptions ----------------------------------------------

// Selection-driven annotation reconciles are an opportunistic consistency
// sweep (they catch keys edited in another session); they must never make
// SELECTING things expensive. Above this many selected nodes, skip the sweep —
// write paths and the page-wide sync (ui-ready / page change / manual refresh)
// still keep annotations correct. Production has no annotations feature at
// all, so any per-selection cost here is a regression against it.
const RECONCILE_SELECTION_LIMIT = 100;

figma.on("selectionchange", () => {
  scheduleEmitSelection();
  // Annotation mutations do NOT fire `documentchange`, so a per-node reconcile
  // on selection is our cheapest path back to consistency after the user has
  // edited keys in another session or in our own UI.
  if (annotationsEnabled && figma.editorType !== "dev") {
    const ids = figma.currentPage.selection.map((n) => n.id);
    if (ids.length > 0 && ids.length <= RECONCILE_SELECTION_LIMIT) {
      scheduleReconcile(ids, annotationsEnabled);
    }
  }
});

figma.on("currentpagechange", () => {
  void (async () => {
    // Page scope contributes to the merged config (language lives per page).
    invalidateConfigCache();
    await emitPageChange();
    if (annotationsEnabled && figma.editorType !== "dev") {
      await syncCurrentPage();
    }
  })();
});

// In `documentAccess: "dynamic-page"` mode, Figma rejects `documentchange`
// registration unless we first call `figma.loadAllPagesAsync()`, which is
// expensive on large files. We deliberately skip it: annotation reconciles
// already happen on `selectionchange` (covers user-visible drift) and after
// our own `set-nodes-data` / `apply-translations` writes (covers our edits).
// Cross-plugin edits to `tolgee_info` would be missed, but that's an edge
// case and the user can hit "Refresh Annotations" from the menu.

figma.on("close", () => {
  // Restore fills on any node still mid-highlight — an unexpected close
  // would otherwise leave layers stuck in the pink pulse colour.
  cleanUpHighlights();
});

// --- UI -> main message handlers --------------------------------------------

on("ui-ready", async () => {
  await refreshAnnotationsEnabled();

  const config = await readMergedConfig();
  const { nodes } = await getSelectionInfo();

  send({
    type: "init",
    config,
    selectedNodes: nodes,
    hasUserSelection: figma.currentPage.selection.length > 0,
    editorType: figma.editorType as "figma" | "dev",
  });

  // Forward the invoked plugin command (if any) so the UI can route to the
  // matching screen after it has finished bootstrapping. `toggle-annotations`
  // is handled as a quick action above and never reaches ui-ready.
  const knownCommands = ["open", "open-on-node"] as const;
  type KnownCommand = (typeof knownCommands)[number];
  const cmd = figma.command as KnownCommand | "";

  // On a regular open, bring annotations back in sync after any external
  // edits made while this plugin instance wasn't running.
  if (annotationsEnabled && figma.editorType !== "dev") {
    await syncCurrentPage();
  }

  if (cmd && knownCommands.includes(cmd)) {
    send({ type: "command", command: cmd });
  }
});

on("resize", (msg) => {
  figma.ui.resize(msg.size.width, msg.size.height);
});

on("close", () => {
  figma.closePlugin();
});

on("notify", (msg) => {
  figma.notify(msg.text, { error: msg.error });
});

on("open-external", (msg) => {
  figma.openExternal(msg.url);
});

// Settings submits its WHOLE form every time, so deciding what a save
// actually changed must compare VALUES, not submitted keys (a save that only
// touched the API key used to trigger a full re-scan of the selection —
// seconds of canvas work on large selections, for nothing).
const IGNORE_RULE_KEYS = [
  "ignoreNumbers",
  "ignoreFormattedNumbers",
  "ignorePrefix",
  "ignoreTextLayers",
  "ignoreHiddenLayers",
  "ignoreHiddenLayersIncludingChildren",
] as const;
const PREFILL_KEYS = ["prefillKeyFormat", "keyFormat", "variableCasing"] as const;

on("save-config", async (msg) => {
  const before = await readMergedConfig();
  await writeConfig(msg.config);
  const merged = await readMergedConfig();
  send({ type: "config-changed", config: merged });
  const ignoreRulesChanged = IGNORE_RULE_KEYS.some((key) => before[key] !== merged[key]);
  const prefillChanged = PREFILL_KEYS.some((key) => before[key] !== merged[key]);
  // Re-scan only when it changes what the scan RETURNS: different ignore
  // filtering, or a prefill format that needs freshly resolved parent names
  // ({frame}/{component}/…). Key regeneration itself happens in the UI from
  // data it already has — re-scanning for a plain format change made a save
  // repaint the list three times (scan overlay + scan result + regeneration
  // patch) instead of once.
  const needsRescan =
    ignoreRulesChanged ||
    (prefillChanged &&
      Boolean(merged.prefillKeyFormat) &&
      keyFormatUsesParents(merged.keyFormat));
  if (needsRescan) {
    await emitSelection();
    if (annotationsEnabled && figma.editorType !== "dev") {
      await syncCurrentPage();
    }
  }
});

// API-key validation lives in the design-mode UI (depends on `openapi-fetch`).
// The UI relays the resolved `projectId` back here so we can persist it at
// the document scope; the inspect (Dev Mode) UI reads it from config to
// build project-aware deep links into the Tolgee web app.
on("persist-project-id", async (msg) => {
  await writeConfig({ projectId: msg.projectId });
  const merged = await readMergedConfig();
  send({ type: "config-changed", config: merged });
});

on("reset", async () => {
  await resetConfig();
  send({ type: "config-changed", config: {} });
  if (annotationsEnabled && figma.editorType !== "dev") {
    await syncCurrentPage();
  }
});

on("set-language", async (msg) => {
  await writeConfig({ language: msg.language });
  send({ type: "config-changed", config: await readMergedConfig() });
});

on("set-branch", async (msg) => {
  await writeConfig({ branch: msg.branch });
  send({ type: "config-changed", config: await readMergedConfig() });
});

on("request-page-connected-nodes", async (msg) => {
  const nodes = await scanConnectedNodes();
  // Chunked — `getNodeInfo` is ~5 bridge reads (incl. a full `characters`
  // copy) per node, and a page-wide Pull can hit thousands of connected nodes.
  const infos: NodeInfo[] = [];
  for (const node of nodes) {
    infos.push(getNodeInfo(node));
    if (infos.length % 50 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  send({
    type: "page-connected-nodes-result",
    correlationId: msg.correlationId,
    nodes: infos,
  });
});

on("set-nodes-data", async (msg) => {
  const result = await setNodesData(msg.nodes);
  // The result carries fresh snapshots of the written nodes so the UI can
  // patch its selection in place. We deliberately do NOT re-scan the whole
  // selection here — with large selections that full re-scan per write is
  // what saturated the canvas thread and froze Figma.
  send({
    type: "nodes-set-result",
    correlationId: msg.correlationId,
    ok: result.ok,
    nodes: result.nodes,
  });
  // Direct plugin-data writes don't always round-trip through documentchange
  // for the same plugin instance — kick the reconciler explicitly. The fresh
  // snapshots ride along so it doesn't re-read pluginData per node.
  if (annotationsEnabled && figma.editorType !== "dev") {
    scheduleReconcile(
      msg.nodes.map((n) => n.id),
      annotationsEnabled,
      result.nodes,
    );
  }
});

on("resolve-parent-names", async (msg) => {
  // Walk each node's ancestors on demand (only the requested nodes, not the
  // whole page) so the bulk "Generate key names" action can resolve parent
  // placeholders for a template that differs from the saved key format.
  // Sequential with periodic yields — the walks are bridge-call heavy, and a
  // parallel batch over a large selection blocks the canvas until it's done.
  const mainComponentNames: MainComponentNameCache = new Map();
  const entries: [string, KeyParentNames][] = [];
  let processed = 0;
  for (const id of msg.nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    entries.push([id, node ? await resolveParentNames(node, mainComponentNames) : {}]);
    processed++;
    if (processed % 25 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  send({
    type: "parent-names-result",
    correlationId: msg.correlationId,
    parents: Object.fromEntries(entries),
  });
});

on("request-screenshots", async (msg) => {
  // Streamed: one message per exported frame, then a terminal marker. Keeps
  // peak memory at one PNG and avoids serializing tens of MB in one go on
  // the canvas thread.
  let index = 0;
  const total = await captureScreenshots(msg.nodeIds, (screenshot) => {
    send({
      type: "screenshot-frame",
      correlationId: msg.correlationId,
      screenshot,
      index: index++,
    });
  });
  send({ type: "screenshots-done", correlationId: msg.correlationId, total });
});

on("scroll-to-node", async (msg) => {
  // `highlightNode` already calls `scrollAndZoomIntoView` and adds the
  // 500ms pink pulse on top, but it bails on dev-mode editors and on text
  // nodes with mixed fills. Falling back to a plain scroll keeps the click
  // useful in those branches.
  await highlightNode(msg.id);
  if (figma.editorType === "dev") {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node && "x" in node) {
      figma.viewport.scrollAndZoomIntoView([node]);
    }
  }
});

on("apply-translations", async (msg) => {
  const { ok, errors, nodes } = await applyTranslations(msg.updates);
  // Fresh post-write snapshots ride along for in-place patching — see the
  // matching comment in the `set-nodes-data` handler.
  send({
    type: "apply-translations-result",
    correlationId: msg.correlationId,
    ok,
    errors,
    nodes,
  });
  if (annotationsEnabled && figma.editorType !== "dev") {
    scheduleReconcile(
      msg.updates.map((u) => u.id),
      annotationsEnabled,
      nodes,
    );
  }
});

on("sync-annotations", async (msg) => {
  if (figma.editorType === "dev") {
    send({
      type: "annotation-sync-result",
      correlationId: msg.correlationId,
      updated: 0,
    });
    return;
  }
  if (msg.all) {
    const { updated } = await syncCurrentPage();
    send({
      type: "annotation-sync-result",
      correlationId: msg.correlationId,
      updated,
    });
    return;
  }
  const ids = figma.currentPage.selection.map((n) => n.id);
  scheduleReconcile(ids, true);
  send({
    type: "annotation-sync-result",
    correlationId: msg.correlationId,
    updated: ids.length,
  });
});

on("toggle-annotations", async (msg) => {
  annotationsEnabled = msg.enabled;
  await setAnnotationsEnabled(msg.enabled);
  if (figma.editorType === "dev") return;
  if (msg.enabled) {
    await syncCurrentPage();
  } else {
    // Cancel any debounced reconcile FIRST so it can't fire after the clear and
    // re-add the annotations we're about to remove.
    cancelReconcile();
    await clearCurrentPage();
  }
});

on("get-annotations-state", async (msg) => {
  const enabled = await isAnnotationsEnabled();
  annotationsEnabled = enabled;
  send({
    type: "annotations-state",
    correlationId: msg.correlationId,
    enabled,
    available: figma.editorType !== "dev",
  });
});

on("create-copy", async (msg) => {
  const result =
    msg.mode === "keys"
      ? await createCopy({ mode: "keys", correlationId: msg.correlationId })
      : await createCopy({
          mode: "languages",
          correlationId: msg.correlationId,
          languages: msg.languages ?? [],
          translations: msg.translations ?? {},
        });
  send({
    type: "create-copy-result",
    correlationId: msg.correlationId,
    ok: result.ok,
    createdPageIds: result.createdPageIds,
    error: result.error,
  });
});
