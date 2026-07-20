<script lang="ts">
  import { ICON } from "$shared/iconSizes";
  import type { NodeInfo } from "$shared/types";
  import { appState } from "$ui/lib/stores/app.svelte";
  import { auth } from "$ui/lib/stores/auth.svelte";
  import { nextCorrelationId, on, send } from "$ui/lib/bus";
  import { createIdleTimeout, type RequestWatchdog } from "$ui/lib/busRequest";
  import { Badge, Button, EmptyState, Message, ProgressBar } from "$ui/lib/components/ui";
  import * as Tooltip from "$ui/lib/components/ui/tooltip";
  import TooltipIconButton from "$ui/lib/components/ui/tooltipIconButton.svelte";
  import { fetchAllTranslations } from "$ui/lib/api/pull";
  import { requestPageConnectedNodes } from "$ui/lib/api/pageNodes";
  import { pullDiff, formatNodeText } from "$ui/lib/logic/pullDiff";
  import { applyCopyPages, type CopyTranslations } from "$ui/lib/logic/copyApply";
  import { namespacedKeyLabel } from "$ui/lib/logic/namespaces";
  import { hasRichFormat } from "$ui/lib/logic/icuParams";
  import { computeVirtualWindow } from "$ui/lib/logic/virtualWindow";
  import Target from "lucide-svelte/icons/target";
  import Download from "lucide-svelte/icons/download";
  import Group from "lucide-svelte/icons/group";
  import KeyRound from "lucide-svelte/icons/key-round";
  import Info from "lucide-svelte/icons/info";

  /**
   * Read-only view for a page the plugin itself generated as a copy (via
   * "Create page" in Index) — matches production's `CopyView`: no editing,
   * just a Download/Download all action to refresh the copy's strings from
   * the latest Tolgee translations, and a plain list of the current
   * selection so the user can jump back to a layer on canvas. `App.svelte`
   * routes here whenever `config.pageCopy` is set, regardless of the active
   * route, so there's no "back" affordance — same as production.
   */

  // The copy's language, persisted page-scoped by `markPageAsCopy` at
  // creation time. Undefined/empty means a "keys" copy (shows Tolgee keys
  // instead of translations) — those never get a Download button, matching
  // production (Download only re-fetches translations, keys never change).
  const language = $derived(appState.value.config?.language);
  const selectedNodes = $derived(appState.value.selectedNodes);
  const hasUserSelection = $derived(appState.value.hasUserSelection);

  const branch = $derived(
    auth.value.branchingEnabled ? (appState.value.config?.branch ?? "") : "",
  );

  type Stage = "idle" | "pulling" | "applying" | "error" | "recreating";
  let stage = $state<Stage>("idle");
  let errorMessage = $state<string | null>(null);
  // Which action landed in "error" — so "Try again" retries the right one.
  let lastFailedAction = $state<"download" | "recreate">("download");
  let fetchProgress = $state<{ loaded: number; total: number | null }>({
    loaded: 0,
    total: null,
  });
  let pageScanProgress = $state<{ done: number; total: number } | null>(null);
  let applyProgress = $state<{ done: number; total: number } | null>(null);
  let applyCorrelationId = $state<string | null>(null);
  // Not `$state` — plain plumbing handle, mirrors Pull.svelte's watchdog.
  let applyWatchdog: RequestWatchdog | null = null;
  const APPLY_TRANSLATIONS_TIMEOUT_MS = 5 * 60_000;

  // Structural drift between this copy and its SOURCE page: the source
  // gained or lost connected strings since the copy was made. Download can't
  // fix either — it only refreshes text on strings the copy already tracks.
  // `false` until checked, or when there's nothing recorded to compare
  // against (older copy, or one made by production). Exact counts aren't
  // worth surfacing — the user can't act on "3 added" any differently than
  // on "something changed", and computing them costs nothing extra on the
  // main-thread side (same two full-page scans either way), so this is a
  // pure UI-side simplification, not a performance change.
  let staleness = $state(false);
  let stalenessCorrelationId: string | null = null;

  let recreateProgress = $state<{ current: number; total: number } | null>(null);
  let recreateCorrelationId = $state<string | null>(null);
  let recreateWatchdog: RequestWatchdog | null = null;
  // The one-language translations map fetched by `recreateCopy`, consumed by
  // the create-copy-result handler once the clone exists (plain plumbing, not
  // `$state` — nothing renders from it).
  let recreateTranslations: Record<string, CopyTranslations> | null = null;
  const RECREATE_TIMEOUT_MS = 5 * 60_000;

  /** "Download all" with nothing selected, "Download" over the current
   *  selection — mirrors production's Pull/Pull all split, just renamed to
   *  match the "Download to Figma" wording already used by Pull.svelte and
   *  Index's SyncButton elsewhere in this app. While a selection scan is
   *  still streaming in (large selections, see `appState.scanning`), say so
   *  instead of silently disabling — clicking mid-scan would download
   *  whatever fraction of the selection had arrived so far, which is exactly
   *  why the button is disabled then too (see the header below). */
  const downloadButtonLabel = $derived(
    appState.value.scanning ? "Scanning…" : hasUserSelection ? "Download" : "Download all",
  );

  // Dev Mode: both of this view's actions (Download → apply-translations,
  // Recreate copy → create-copy) are canvas-classed and hard-blocked by the
  // bus guard — showing their buttons would only ever produce the error
  // toast. The staleness BANNER stays visible (knowing the copy is outdated
  // is useful read-only information); only the remedies are hidden.
  const isDev = $derived(appState.value.editorType === "dev");

  // Persists across the "toast disappears" problem: once a download
  // finishes, this stays on screen as a dismissable success message — the
  // user gets to see what actually happened instead of relying on a fleeting
  // notification. Cleared by the selection-change watch below, or manually
  // via the message's own close button.
  let lastResult = $state<{ count: number } | null>(null);
  // Count of nodes an in-flight apply is updating — captured at send time so
  // the result handler can report it once `applyProgress` is cleared.
  let pendingApplyCount = 0;

  const lastResultText = $derived.by(() => {
    if (!lastResult) return null;
    if (lastResult.count === 0) return "No changes found.";
    const noun = lastResult.count === 1 ? "string" : "strings";
    return `Downloaded ${lastResult.count} ${noun}.`;
  });

  // Not `$state` — plain closure memory for the selection-change watch below,
  // compared by VALUE (not by the `selectedNodes` array's reference) so a
  // content-only patch (e.g. `apply-translations-result` rewriting the just-
  // downloaded nodes' `characters` in place) doesn't look like a selection
  // change and wipe out the success message we just showed for it.
  let lastSelectionSignature: string | null = null;

  // Any ACTUAL selection change — a different set of node ids, a flip of
  // `hasUserSelection`, or switching to a different copy page — means the
  // success message and the view below it describe a selection that's no
  // longer current. Clearing `lastResult` here both dismisses the banner and
  // lets the view re-render from the fresh selection (the with/without-
  // selection branches below no longer gate on `lastResult` at all).
  $effect(() => {
    const signature = `${appState.value.pageName}|${hasUserSelection}|${selectedNodes.map((n) => n.id).join(",")}`;
    if (lastSelectionSignature !== null && signature !== lastSelectionSignature) {
      lastResult = null;
    }
    lastSelectionSignature = signature;
  });

  /** "N strings" (+ "(M connected)" when not all of them are) — the raw
   *  count of whatever's being looked at, plus how many of those are
   *  actually connected (a prefilled-but-never-pushed key still shows up in
   *  a selection/page scan, but Download silently skips it — the connected
   *  count is what Download will actually act on). */
  function formatCountLine(total: number, connected: number): string {
    const base = `${total} ${total === 1 ? "string" : "strings"}`;
    return connected < total ? `${base} (${connected} connected)` : base;
  }

  const countRowText = $derived(
    formatCountLine(
      selectedNodes.length,
      selectedNodes.filter((n) => n.connected).length,
    ),
  );

  function formatKeyLabel(node: NodeInfo): string {
    return namespacedKeyLabel(node.ns, node.key, auth.value.namespacesEnabled);
  }

  function showOnCanvas(id: string): void {
    send({ type: "scroll-to-node", id });
  }

  async function pull(): Promise<void> {
    const lang = language;
    if (!lang) return;
    lastFailedAction = "download";
    const client = auth.value.client;
    if (!client) {
      stage = "error";
      errorMessage = "Not connected to Tolgee.";
      return;
    }

    stage = "pulling";
    errorMessage = null;
    pageScanProgress = null;
    fetchProgress = { loaded: 0, total: null };

    try {
      // "Download all" has no eager page-wide scan to reuse (removed — it
      // cost a full scan just to show a count nobody could act on), so this
      // is always a fresh scan on click.
      const targetNodes: NodeInfo[] = hasUserSelection
        ? selectedNodes
        : await requestPageConnectedNodes(undefined, (done, total) => {
            pageScanProgress = { done, total };
          });

      // Filtered to exactly `targetNodes`' connected keys (no `namespaces` —
      // each node is matched to its remote key by its OWN `ns`, same
      // reasoning as the main Pull view) instead of paginating the whole
      // project, same fix as Pull.svelte.
      const keyNames = Array.from(
        new Set(targetNodes.map((n) => n.key).filter((k): k is string => Boolean(k))),
      );
      const remoteKeys = await fetchAllTranslations(client, {
        languages: [lang],
        branch: branch || undefined,
        keyNames,
        onProgress: (loaded, total) => {
          fetchProgress = { loaded, total };
        },
      });

      const diff = pullDiff(targetNodes, remoteKeys, lang);
      if (diff.changedNodes.length === 0) {
        stage = "idle";
        // Just describes THIS check's result — Tolgee can change again a
        // second later, so this is never phrased as an ongoing guarantee.
        lastResult = { count: 0 };
        send({ type: "notify", text: "No changes found." });
        return;
      }

      applyChanges(diff.changedNodes, lang);
    } catch (err) {
      stage = "error";
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  function applyChanges(
    changedNodes: ReturnType<typeof pullDiff>["changedNodes"],
    lang: string,
  ): void {
    stage = "applying";
    applyProgress = { done: 0, total: changedNodes.length };
    pendingApplyCount = changedNodes.length;
    const correlationId = nextCorrelationId();
    applyCorrelationId = correlationId;
    applyWatchdog?.clear();
    applyWatchdog = createIdleTimeout(APPLY_TRANSLATIONS_TIMEOUT_MS, () => {
      stage = "error";
      errorMessage = "Timed out waiting for the translations to apply.";
      applyProgress = null;
      applyCorrelationId = null;
      applyWatchdog = null;
    });

    const updates = changedNodes.map(({ node, newText, isPlural }) => {
      const { text } = formatNodeText(node, newText, lang);
      return { id: node.id, text, translation: newText, isPlural };
    });

    send({ type: "apply-translations", correlationId, updates });
  }

  $effect(() => {
    const off = on("apply-translations-progress", (msg) => {
      if (msg.correlationId !== applyCorrelationId) return;
      applyWatchdog?.touch();
      applyProgress = { done: msg.done, total: msg.total };
    });
    return off;
  });

  $effect(() => {
    const off = on("apply-translations-result", (msg) => {
      if (msg.correlationId !== applyCorrelationId) return;
      applyWatchdog?.clear();
      applyWatchdog = null;
      applyProgress = null;
      if (msg.ok) {
        stage = "idle";
        lastResult = { count: pendingApplyCount };
        const noun = pendingApplyCount === 1 ? "string" : "strings";
        send({ type: "notify", text: `Downloaded ${pendingApplyCount} ${noun} to Figma.` });
      } else {
        stage = "error";
        errorMessage = msg.errors[0] ?? "Failed to apply translations to one or more nodes.";
      }
    });
    return off;
  });

  // Re-checks whenever the current page changes (reading `pageName` gives
  // Svelte a dependency to track) — this component stays mounted across
  // page switches, so a one-shot effect would only ever check the FIRST
  // copy page the user opened.
  $effect(() => {
    void appState.value.pageName;
    const correlationId = nextCorrelationId();
    stalenessCorrelationId = correlationId;
    staleness = false;
    send({ type: "request-copy-staleness", correlationId });
  });

  $effect(() => {
    const off = on("copy-staleness-result", (msg) => {
      if (msg.correlationId !== stalenessCorrelationId) return;
      if (!msg.ok && msg.error) {
        // A skipped check is expected for copies made before sourcePageId
        // tracking existed, but it must never be INVISIBLE — diagnosing
        // "the banner never shows" blind cost a full report round-trip once.
        console.warn("[tolgee] copy staleness check skipped:", msg.error);
      }
      const added = msg.missingCount ?? 0;
      const removed = msg.removedCount ?? 0;
      staleness = msg.ok && added + removed > 0;
    });
    return off;
  });

  /**
   * Re-clones this copy from its recorded source page (same underlying
   * `create-copy` mode the "Create page" flow already uses) so it picks up
   * any keys connected on the original since this copy was made — Download
   * alone can never discover those, it only refreshes text for keys the copy
   * already tracks.
   */
  async function recreateCopy(): Promise<void> {
    const sourcePageId = appState.value.config?.sourcePageId;
    if (!sourcePageId) return;

    lastFailedAction = "recreate";
    stage = "recreating";
    errorMessage = null;
    recreateProgress = null;
    const correlationId = nextCorrelationId();
    recreateCorrelationId = correlationId;
    recreateWatchdog?.clear();
    recreateWatchdog = createIdleTimeout(RECREATE_TIMEOUT_MS, () => {
      stage = "error";
      errorMessage = "Timed out waiting for the copy to be recreated.";
      recreateProgress = null;
      recreateCorrelationId = null;
      recreateWatchdog = null;
    });

    try {
      if (!language) {
        send({
          type: "create-copy",
          correlationId,
          mode: "keys",
          sourcePageId,
          namespacesEnabled: auth.value.namespacesEnabled,
        });
        return;
      }
      const client = auth.value.client;
      if (!client) {
        stage = "error";
        errorMessage = "Not connected to Tolgee.";
        return;
      }
      const keys = await fetchAllTranslations(client, {
        languages: [language],
        namespaces: undefined,
        branch: branch || undefined,
      });
      const translationsForLang: CopyTranslations = {};
      for (const k of keys) {
        const idx = `${k.keyNamespace ?? ""}|${k.keyName}`;
        const text = k.translations[language]?.text;
        if (text) translationsForLang[idx] = { text, isPlural: k.isPlural };
      }
      // Held for the create-copy-result handler below: once the clone exists,
      // the UI renders + applies these onto it (the main thread can't — no
      // `Intl` in its sandbox, see $ui/lib/logic/copyApply).
      recreateTranslations = { [language]: translationsForLang };
      send({
        type: "create-copy",
        correlationId,
        mode: "languages",
        languages: [language],
        sourcePageId,
      });
    } catch (err) {
      stage = "error";
      errorMessage = err instanceof Error ? err.message : String(err);
      recreateWatchdog?.clear();
      recreateWatchdog = null;
    }
  }

  $effect(() => {
    const off = on("create-copy-progress", (msg) => {
      if (msg.correlationId !== recreateCorrelationId) return;
      recreateWatchdog?.touch();
      recreateProgress = { current: msg.current, total: msg.total };
    });
    return off;
  });

  $effect(() => {
    const off = on("create-copy-result", (msg) => {
      if (msg.correlationId !== recreateCorrelationId) return;
      recreateWatchdog?.clear();
      recreateWatchdog = null;
      recreateProgress = null;
      recreateCorrelationId = null;
      if (!msg.ok) {
        recreateTranslations = null;
        stage = "error";
        errorMessage = msg.error ?? "Failed to recreate the copy.";
        return;
      }
      // The clone exists but still holds the SOURCE page's text — render +
      // write the fetched translations from here (the main thread can't: no
      // `Intl` in its sandbox). Same pipeline as the Download flow.
      const pages = msg.pages ?? [];
      const translations = recreateTranslations;
      recreateTranslations = null;
      void (async () => {
        if (pages.length > 0 && translations) {
          const applied = await applyCopyPages(pages, translations, (done, total) => {
            recreateProgress = { current: done, total };
          });
          recreateProgress = null;
          if (!applied.ok) {
            stage = "error";
            errorMessage = applied.error ?? "Failed to recreate the copy.";
            return;
          }
        }
        stage = "idle";
        staleness = false;
        send({ type: "notify", text: "Copy recreated." });
        // The main thread may have switched `figma.currentPage` to the fresh
        // replacement (this page can't delete itself while active) —
        // App.svelte's existing `currentpagechange` listener re-syncs
        // config/selection for it automatically.
      })();
    });
    return off;
  });

  // ---- Chrome/list split & windowing ----------------------------------------
  // Chrome (staleness banner, progress/error/success messages, count row)
  // stays fixed above; the selection list gets its OWN scroll region so a huge
  // manual selection doesn't have to share scroll math with everything above
  // it — same split Index/NodeList already uses, not just a perf tweak.
  const chromeVisible = $derived(
    stage !== "idle" || Boolean(staleness) || lastResult !== null || selectedNodes.length > 0,
  );

  // Same threshold/overscan as NodeList.svelte, for consistency — this list's
  // rows are lighter (no inputs/menu, just one icon button), so windowing
  // matters less per-row, but a large MANUAL selection on a copy page is the
  // same class of "thousands of rows" risk Index already solved.
  const LIST_VIRTUALIZE_FROM = 60;
  const LIST_OVERSCAN = 6;
  const LIST_FALLBACK_ROW_PX = 60;

  let listViewport = $state<HTMLElement | null>(null);
  let listScrollTop = $state(0);
  let listViewportHeight = $state(0);
  let listRowHeight = $state(LIST_FALLBACK_ROW_PX);

  const listVirtual = $derived(selectedNodes.length >= LIST_VIRTUALIZE_FROM);
  const listWindow = $derived(
    computeVirtualWindow(
      selectedNodes.length,
      listScrollTop,
      listViewportHeight,
      listRowHeight,
      LIST_OVERSCAN,
    ),
  );
  const visibleSelectedNodes = $derived(
    listVirtual ? selectedNodes.slice(listWindow.start, listWindow.end) : selectedNodes,
  );

  // Measures the AVERAGE rendered row height whenever the visible window
  // changes, same reasoning as NodeList.svelte: connected vs "Not connected"
  // rows differ by a line, so a single-row sample would oscillate as the
  // window's first row flips type. 2px tolerance keeps this from looping.
  $effect(() => {
    void visibleSelectedNodes;
    if (!listVirtual || !listViewport) return;
    const list = listViewport.querySelector("ul");
    const count = list?.children.length ?? 0;
    if (!list || count === 0) return;
    const measured = list.getBoundingClientRect().height / count;
    if (measured > 0 && Math.abs(measured - listRowHeight) > 2) listRowHeight = measured;
  });
</script>

<div class="flex h-full flex-col">
  <Tooltip.Provider delayDuration={200}>
    <header
      class="flex items-center justify-between gap-2 bg-linear-to-b from-bg to-header-gradient-end border-b border-border px-3 py-2"
    >
      <h1 class="flex h-7 min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-semibold">
        <span class="truncate">{appState.value.pageName} (copy)</span>
        {#if !language}
          <TooltipIconButton
            label="About this page"
            tooltip="Shows Tolgee keys. Doesn't sync back."
            class="text-text-secondary"
          >
            <Info size={ICON.inline} />
          </TooltipIconButton>
        {/if}
      </h1>
      {#if language && !isDev}
        <Button
          size="sm"
          disabled={stage === "pulling" ||
            stage === "applying" ||
            stage === "recreating" ||
            appState.value.scanning}
          onclick={pull}
        >
          {downloadButtonLabel}
        </Button>
      {/if}
    </header>

    <div class="flex flex-1 flex-col overflow-hidden">
      {#if chromeVisible}
        <!-- Fixed above the list (own scroll region below) — a staleness
             banner or count row shouldn't scroll out of view just because
             the selection below it is long. -->
        <div class="flex shrink-0 flex-col gap-3 p-3">
          {#if staleness && stage !== "recreating"}
            <!-- The source page gained connections since this copy was made —
                 Download can't discover those on its own (it only refreshes text
                 for keys the copy already tracks), so recreating is the only fix. -->
            <Message variant="info" class="items-start">
              <div class="space-y-1.5">
                <p>The original page changed since this copy was made.</p>
                {#if !isDev}
                  <Button
                    size="sm"
                    variant="outline"
                    class="bg-bg!"
                    disabled={stage === "pulling" || stage === "applying"}
                    onclick={recreateCopy}
                  >
                    Recreate copy
                  </Button>
                {/if}
              </div>
            </Message>
          {/if}

          {#if stage === "pulling"}
            {#if hasUserSelection}
              <ProgressBar
                loaded={fetchProgress.loaded}
                total={fetchProgress.total}
                label="Loading translations from Tolgee"
              />
            {:else if pageScanProgress}
              <ProgressBar
                loaded={pageScanProgress.done}
                total={pageScanProgress.total}
                label="Scanning page for connected keys…"
              />
            {:else}
              <ProgressBar
                loaded={fetchProgress.loaded}
                total={fetchProgress.total}
                label="Loading translations from Tolgee"
              />
            {/if}
          {:else if stage === "applying"}
            <ProgressBar
              loaded={applyProgress?.done ?? 0}
              total={applyProgress?.total ?? null}
              label="Applying translations"
            />
          {:else if stage === "recreating"}
            <ProgressBar
              loaded={recreateProgress?.current ?? 0}
              total={recreateProgress?.total ?? null}
              label="Recreating copy…"
            />
          {:else if stage === "error"}
            <Message variant="error">{errorMessage ?? "Something went wrong."}</Message>
            <Button
              variant="secondary"
              disabled={lastFailedAction === "download" && appState.value.scanning}
              onclick={lastFailedAction === "recreate" ? recreateCopy : pull}
            >
              Try again
            </Button>
          {:else if lastResult}
            <Message variant="success" onDismiss={() => (lastResult = null)}>{lastResultText}</Message>
          {/if}

          {#if (stage === "idle" || stage === "error") && selectedNodes.length > 0}
            <!-- Count row mirrors Index's (no select-all checkbox — nothing here
                 is bulk-actionable). -->
            <div class="text-xs text-text-secondary">{countRowText}</div>
          {/if}
        </div>
      {/if}

      {#if stage === "idle" || stage === "error"}
        {#if selectedNodes.length === 0}
          <div class="flex flex-1 flex-col overflow-auto px-3 pb-3">
            {#if language && isDev}
              <!-- Download is hidden in Dev Mode — don't instruct an action
                   that doesn't exist there; selecting still lists strings. -->
              <EmptyState icon={Group} title="Select a string or frame" />
            {:else if language}
              <EmptyState
                icon={Download}
                title="Download strings to Figma."
                description="All, or just the selected frames."
              />
            {:else}
              <EmptyState
                icon={KeyRound}
                title="Select a string or frame"
                description="Shows its key below."
              />
            {/if}
          </div>
        {:else}
          <!-- Own scroll region, windowed above LIST_VIRTUALIZE_FROM rows (see
               script) — mirrors NodeList.svelte's split so a huge manual
               selection doesn't mount hundreds of rows at once. -->
          <div
            bind:this={listViewport}
            bind:clientHeight={listViewportHeight}
            onscroll={() => (listScrollTop = listViewport?.scrollTop ?? 0)}
            class="flex-1 min-h-0 overflow-auto px-3 pb-3"
          >
            {#if listWindow.padTop > 0}
              <div style="height: {listWindow.padTop}px" aria-hidden="true"></div>
            {/if}
            <!-- Mirrors NodeListItem's read-only half (string + Plural/Formatted
                 badges, key glyph below) — same visual language as the main
                 Index list, minus anything editable (this view never writes).
                 Unconnected nodes are listed too, with "Not connected" instead
                 of a key — hiding them read as if the selection were smaller
                 than it is. -->
            <ul>
              {#each visibleSelectedNodes as node (node.id)}
                <li
                  class="flex items-start gap-1.5 border-b border-dashed border-border py-2.5 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <div class="min-w-0 flex-1 space-y-1.5">
                    <div class="flex items-center gap-1.5">
                      <span class="min-w-0 truncate text-xs text-text" title={node.characters}>
                        {node.characters || "(empty)"}
                      </span>
                      {#if node.connected}
                        {#if node.isPlural}<Badge>Plural</Badge>{/if}
                        {#if hasRichFormat(node)}<Badge>Formatted</Badge>{/if}
                      {/if}
                    </div>
                    <div class="flex items-center gap-1.5">
                      {#if node.connected}
                        <KeyRound size={ICON.inline} class="shrink-0 text-text-secondary" />
                        <span class="min-w-0 truncate text-xs font-semibold text-text-secondary">
                          {formatKeyLabel(node)}
                        </span>
                      {:else}
                        <span class="text-xs italic text-text-secondary">Not connected</span>
                      {/if}
                    </div>
                  </div>
                  <TooltipIconButton label="Move to string" onclick={() => showOnCanvas(node.id)}>
                    <Target size={ICON.inline} />
                  </TooltipIconButton>
                </li>
              {/each}
            </ul>
            {#if listWindow.padBottom > 0}
              <div style="height: {listWindow.padBottom}px" aria-hidden="true"></div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </Tooltip.Provider>
</div>
