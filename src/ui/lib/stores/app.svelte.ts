import type { NodeInfo, Route, TolgeeConfig } from "$shared/types";
import { flushNodeSaves } from "$ui/lib/logic/saveQueue";

type AppState = {
  config: Partial<TolgeeConfig> | null;
  selectedNodes: NodeInfo[];
  /**
   * `true` when the user has at least one node selected on the current
   * Figma page. With no selection, `selectedNodes` is EMPTY (the main thread
   * deliberately never falls back to a page-wide scan) — this flag exists so
   * consumers can distinguish "nothing selected" from "selection contains no
   * usable text nodes".
   */
  hasUserSelection: boolean;
  /**
   * `true` when a selection scan on the main thread has been running longer
   * than the spinner delay (see `setScanning`) and its nodes haven't arrived
   * yet. Drives the Index loading overlay for genuinely slow scans only —
   * quick scans (the overwhelming majority) never flip it, so ordinary canvas
   * clicks don't flash the overlay.
   */
  scanning: boolean;
  route: Route;
  editorType: "figma" | "dev";
  errorBanner: { message: string; severity: "error" | "warning" } | null;
};

/**
 * Reads the initial route from the E2E host page's URL state param.
 *
 * In E2E tests the host page and the plugin iframe share the same origin
 * (localhost:4173), so `window.parent.location.search` is accessible and
 * contains the ?state=… query the test fixtures encode. Reading it here —
 * synchronously, before the first render — lets the app start in the correct
 * view without a reactive navigate() call.
 *
 * In Figma the plugin iframe is sandboxed at a different origin; accessing
 * window.parent.location throws a SecurityError that we swallow silently.
 */
function getInitialRoute(): Route {
  try {
    const params = new URLSearchParams(window.parent.location.search);
    const raw = params.get("state");
    if (raw) {
      const parsed = JSON.parse(raw) as { route?: string };
      if (parsed.route) return { name: parsed.route } as Route;
    }
  } catch {
    // Cross-origin (Figma sandbox) or missing state — fall through.
  }
  return { name: "index" };
}

function createAppState() {
  const state = $state<Omit<AppState, "selectedNodes">>({
    config: null,
    hasUserSelection: false,
    scanning: false,
    route: getInitialRoute(),
    editorType: "figma",
    errorBanner: null,
  });
  // `$state.raw`: the nodes are immutable snapshots from the main thread and
  // are only ever replaced wholesale (setSelection / patchNodes), so deep
  // proxying hundreds of them — every field read of every row going through a
  // proxy trap — is pure overhead. Reactivity comes from reassignment.
  let selectedNodes = $state.raw<NodeInfo[]>([]);

  // Delayed scan spinner: most scans finish in well under this, and flashing
  // the loading overlay for every canvas click reads as jank. Arm a timer on
  // `selection-pending` and only flip `scanning` if the nodes haven't arrived
  // by then — quick scans never show the overlay at all.
  const SCAN_SPINNER_DELAY_MS = 200;
  let scanSpinnerTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelScanSpinner(): void {
    if (scanSpinnerTimer) {
      clearTimeout(scanSpinnerTimer);
      scanSpinnerTimer = null;
    }
  }

  // Stable read view combining the reactive state with the raw node array,
  // so consumers keep the `appState.value.selectedNodes` shape.
  const view = {
    get config() {
      return state.config;
    },
    get selectedNodes() {
      return selectedNodes;
    },
    get hasUserSelection() {
      return state.hasUserSelection;
    },
    get scanning() {
      return state.scanning;
    },
    get route() {
      return state.route;
    },
    get editorType() {
      return state.editorType;
    },
    get errorBanner() {
      return state.errorBanner;
    },
  };

  return {
    get value() {
      return view;
    },
    setConfig(c: Partial<TolgeeConfig> | null) {
      state.config = c;
    },
    setSelection(nodes: NodeInfo[], hasUserSelection: boolean) {
      selectedNodes = nodes;
      state.hasUserSelection = hasUserSelection;
      cancelScanSpinner();
      state.scanning = false;
    },
    /**
     * Merge fresh post-write snapshots into the current selection by node id.
     * Untouched rows keep their object identity, so the keyed `{#each}` list
     * doesn't re-mount them. Nodes not currently in the selection are ignored
     * (a Pull can write page-wide, beyond the selection). This replaces the
     * old whole-selection re-scan the main thread used to do after writes.
     */
    patchNodes(updated: NodeInfo[]) {
      if (updated.length === 0) return;
      const byId = new Map(updated.map((n) => [n.id, n]));
      selectedNodes = selectedNodes.map((n) => byId.get(n.id) ?? n);
    },
    setScanning() {
      if (scanSpinnerTimer || state.scanning) return;
      scanSpinnerTimer = setTimeout(() => {
        scanSpinnerTimer = null;
        state.scanning = true;
      }, SCAN_SPINNER_DELAY_MS);
    },
    navigate(route: Route) {
      // Persist any debounced inline edits BEFORE the destination flow reads
      // node state — Push must diff the key the user just typed, not the one
      // still sitting in the queue.
      flushNodeSaves();
      state.route = route;
    },
    setEditorType(t: "figma" | "dev") {
      state.editorType = t;
    },
    setError(banner: AppState["errorBanner"]) {
      state.errorBanner = banner;
    },
  };
}

export const appState = createAppState();
