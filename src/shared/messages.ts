import type { KeyParentNames } from "./keyFormat";
import type { FrameScreenshot, NodeInfo, TolgeeConfig, WindowSize } from "./types";

/**
 * Messages sent from the main thread (Plugin sandbox) to the UI iframe.
 */
export type MainToUi =
  | {
      type: "init";
      config: Partial<TolgeeConfig> | null;
      selectedNodes: NodeInfo[];
      /** See `selection-changed.hasUserSelection`. */
      hasUserSelection: boolean;
      editorType: "figma" | "dev";
      /** Optional: navigate to this route immediately after init (used by E2E tests). */
      initialRoute?: string;
    }
  | {
      type: "selection-changed";
      nodes: NodeInfo[];
      /**
       * `true` iff the user has at least one node selected on the current
       * page. When `false`, `nodes` holds the page-wide connected-node
       * fallback and a "you have a selection but … will be applied to all"
       * hint would be misleading.
       */
      hasUserSelection: boolean;
    }
  | {
      /**
       * Emitted the instant `selectionchange` fires, BEFORE the (potentially
       * slow) selection scan. Lets the UI show a loader during the scan instead
       * of only after `selection-changed` arrives. Carries no data — the UI
       * just flips into a "scanning" state until the matching
       * `selection-changed` lands.
       */
      type: "selection-pending";
    }
  | {
      /** One chunk of a STREAMED selection scan. Large selections used to
          arrive as a single `selection-changed` only after every node's info
          was built — thousands of nodes meant many seconds of built-up work
          before the UI showed anything. Batches let the list render within
          the first ~100 nodes and fill in progressively; a superseding
          selection simply stops the remaining batches. `first: true`
          replaces the list, subsequent batches append. Closed by
          `selection-done`. (`selection-changed` remains for non-streamed
          senders: empty selections, init, and the e2e host.) */
      type: "selection-batch";
      nodes: NodeInfo[];
      first: boolean;
    }
  | {
      /** Terminal marker of a streamed selection scan. `total` lets the UI
          clear the list when the scan yielded zero usable text nodes (no
          `selection-batch` was sent at all). */
      type: "selection-done";
      hasUserSelection: boolean;
      total: number;
    }
  | { type: "page-changed"; config: Partial<TolgeeConfig> }
  | { type: "config-changed"; config: Partial<TolgeeConfig> }
  | {
      /** One exported frame. Screenshots stream one message per frame — a
          single message carrying every PNG serialized tens of MB on the
          canvas thread and held all buffers in memory at once. */
      type: "screenshot-frame";
      correlationId: string;
      screenshot: FrameScreenshot;
      index: number;
    }
  | {
      /** Terminal marker for a `request-screenshots` stream. `total` is the
          number of `screenshot-frame` messages that were sent. */
      type: "screenshots-done";
      correlationId: string;
      total: number;
    }
  | {
      type: "nodes-set-result";
      correlationId: string;
      ok: boolean;
      /** Fresh post-write snapshots of the updated nodes. The UI patches its
          selection in place from these — the main thread deliberately does
          NOT re-scan the whole selection after a write (that full re-scan
          per write is what froze large selections). */
      nodes: NodeInfo[];
    }
  | {
      /** Parent placeholder names resolved on demand — see the matching
          `resolve-parent-names` request. Keyed by node id; a missing id (or
          missing field) means the node has no such ancestor. */
      type: "parent-names-result";
      correlationId: string;
      parents: Record<string, KeyParentNames>;
    }
  | {
      type: "page-connected-nodes-result";
      correlationId: string;
      nodes: NodeInfo[];
    }
  | {
      type: "apply-translations-result";
      correlationId: string;
      ok: boolean;
      errors: string[];
      /** See `nodes-set-result.nodes` — post-write snapshots for in-place
          patching instead of a full selection re-scan. */
      nodes: NodeInfo[];
    }
  | {
      type: "create-copy-progress";
      correlationId: string;
      current: number;
      total: number;
      phase: string;
    }
  | {
      type: "create-copy-result";
      correlationId: string;
      ok: boolean;
      createdPageIds: string[];
      error?: string;
    }
  | {
      type: "command";
      command: "open" | "open-on-node";
    };

/**
 * Messages sent from the UI iframe back to the main thread (Plugin sandbox).
 */
export type UiToMain =
  | { type: "ui-ready" }
  | { type: "resize"; size: WindowSize }
  | { type: "close" }
  | { type: "notify"; text: string; error?: boolean }
  | { type: "open-external"; url: string }
  | { type: "save-config"; config: Partial<TolgeeConfig> }
  /**
   * Persist a project id resolved from the API key during a successful
   * `Test Connection` in the design-mode UI. The main thread writes this
   * into the document-scoped config so the inspect (Dev Mode) UI can build
   * project-aware deep links without performing its own API validation.
   */
  | { type: "persist-project-id"; projectId: number }
  | { type: "reset" }
  | { type: "set-language"; language: string }
  | { type: "set-branch"; branch: string }
  /**
   * Request every connected text node on the current page, independent of
   * the user's current selection. Used by Pull when the language changes so
   * the new translations land on the whole page, not just selected layers.
   */
  | { type: "request-page-connected-nodes"; correlationId: string }
  | {
      type: "set-nodes-data";
      correlationId: string;
      nodes: Array<{ id: string; info: Partial<NodeInfo> }>;
    }
  /**
   * Resolve the parent placeholder names ({component}/{frame}/…) for specific
   * nodes on demand. The selection scan only fills these when the SAVED format
   * uses them; the bulk "Generate key names" action lets the user type an
   * ad-hoc template, so it asks for them here right before formatting.
   */
  | { type: "resolve-parent-names"; correlationId: string; nodeIds: string[] }
  | {
      type: "apply-translations";
      correlationId: string;
      updates: Array<{
        id: string;
        /** Final, ICU-formatted text to write into the TextNode. */
        text: string;
        /** Raw translation source to persist into plugin data. */
        translation: string;
        /** Optional plural flag to update along with the translation. */
        isPlural?: boolean;
        /** Optional plural parameter name when isPlural === true. */
        pluralParamValue?: string;
        /** Optional sample parameter values for ICU preview. */
        paramsValues?: Record<string, string>;
        /** Optional key updates so a single round-trip can both label and
            re-render the node (used by StringDetails save). */
        key?: string;
        ns?: string;
        connected?: boolean;
      }>;
    }
  | {
      type: "request-screenshots";
      correlationId: string;
      nodeIds: string[];
    }
  | { type: "scroll-to-node"; id: string }
  | {
      type: "create-copy";
      correlationId: string;
      mode: "keys" | "languages";
      /** Required when `mode === "languages"`. List of language tags to copy. */
      languages?: string[];
      /**
       * Required when `mode === "languages"`. Map of language tag -> map of
       * `${ns}|${key}` -> translation text. The UI builds this from the
       * Tolgee API so the main thread doesn't need to refetch.
       */
      translations?: Record<string, Record<string, string>>;
    };

/**
 * Helper type to extract the message variant that carries a `correlationId`.
 * Useful for building request/response pairing in the message bus.
 */
export type WithCorrelationId<T> = T extends { correlationId: string } ? T : never;

export type MainToUiResponse = WithCorrelationId<MainToUi>;
export type UiToMainRequest = WithCorrelationId<UiToMain>;
