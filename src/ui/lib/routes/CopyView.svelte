<script lang="ts">
  import { ICON } from "$shared/iconSizes";
  import type { NodeInfo } from "$shared/types";
  import { appState } from "$ui/lib/stores/app.svelte";
  import { auth } from "$ui/lib/stores/auth.svelte";
  import { nextCorrelationId, on, send } from "$ui/lib/bus";
  import { createIdleTimeout, type RequestWatchdog } from "$ui/lib/busRequest";
  import { Button, EmptyState, Message, ProgressBar } from "$ui/lib/components/ui";
  import * as Tooltip from "$ui/lib/components/ui/tooltip";
  import TooltipIconButton from "$ui/lib/components/ui/tooltipIconButton.svelte";
  import { fetchAllTranslations } from "$ui/lib/api/pull";
  import { requestPageConnectedNodes } from "$ui/lib/api/pageNodes";
  import { pullDiff, formatNodeText } from "$ui/lib/logic/pullDiff";
  import { namespacedKeyLabel } from "$ui/lib/logic/namespaces";
  import Group from "lucide-svelte/icons/group";
  import Target from "lucide-svelte/icons/target";
  import Download from "lucide-svelte/icons/download";

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

  type Stage = "idle" | "pulling" | "applying" | "error";
  let stage = $state<Stage>("idle");
  let errorMessage = $state<string | null>(null);
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

  /** "Download all" with nothing selected, "Download" over the current
   *  selection — mirrors production's Pull/Pull all split, just renamed to
   *  match the "Download to Figma" wording already used by Pull.svelte and
   *  Index's SyncButton elsewhere in this app. */
  const downloadButtonLabel = $derived(hasUserSelection ? "Download" : "Download all");

  // Persists across the "toast disappears" problem: once a download
  // finishes, this stays on screen (replacing the pre-download instruction
  // text) until the NEXT download starts — the user gets to see what
  // actually happened instead of relying on a fleeting notification.
  let lastResult = $state<{ count: number } | null>(null);
  // Count of nodes an in-flight apply is updating — captured at send time so
  // the result handler can report it once `applyProgress` is cleared.
  let pendingApplyCount = 0;

  // `null` means: don't show the top status line at all — the big
  // instructional EmptyState below already says the same thing, so a top
  // line here would just repeat it.
  const topStatusText = $derived.by(() => {
    if (!language) return "Shows Tolgee keys. Doesn't sync back.";
    if (lastResult === null) {
      return selectedNodes.length > 0
        ? "Download strings to Figma."
        : null;
    }
    if (lastResult.count === 0) return "No changes found.";
    const noun = lastResult.count === 1 ? "string" : "strings";
    return `Downloaded ${lastResult.count} ${noun}.`;
  });

  function formatKeyLabel(node: NodeInfo): string {
    if (!node.key) return "Not connected";
    return namespacedKeyLabel(node.ns, node.key, auth.value.namespacesEnabled);
  }

  function showOnCanvas(id: string): void {
    send({ type: "scroll-to-node", id });
  }

  async function pull(): Promise<void> {
    const lang = language;
    if (!lang) return;
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
      const targetNodes: NodeInfo[] = hasUserSelection
        ? selectedNodes
        : await requestPageConnectedNodes(undefined, (done, total) => {
            pageScanProgress = { done, total };
          });

      // Fetch ALL namespaces (not just the configured default) — each node
      // is matched to its remote key by its OWN `ns`, same reasoning as the
      // main Pull view.
      const remoteKeys = await fetchAllTranslations(client, {
        languages: [lang],
        namespaces: undefined,
        branch: branch || undefined,
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
</script>

<div class="flex h-full flex-col">
  <header
    class="flex items-center justify-between gap-2 bg-linear-to-b from-bg to-header-gradient-end border-b border-border px-3 py-2"
  >
    <h1 class="flex h-7 min-w-0 flex-1 items-center truncate text-sm font-semibold">
      {appState.value.pageName} (copy)
    </h1>
    {#if language}
      <Button
        size="sm"
        disabled={stage === "pulling" || stage === "applying"}
        onclick={pull}
      >
        {downloadButtonLabel}
      </Button>
    {/if}
  </header>

  <Tooltip.Provider delayDuration={200}>
    <div class="flex flex-1 flex-col overflow-auto p-3 space-y-3">
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
      {:else if stage === "error"}
        <Message variant="error">{errorMessage ?? "Something went wrong."}</Message>
        <Button variant="secondary" onclick={pull}>Try again</Button>
      {:else if topStatusText}
        <p class="text-xs text-text-secondary">{topStatusText}</p>
      {/if}

      {#if stage === "idle" || stage === "error"}
        {#if selectedNodes.length === 0}
          {#if language && lastResult === null}
            <EmptyState
              icon={Download}
              title="Download strings to Figma."
              description="Download all, or select frames to update specific strings."
            />
          {:else}
            <EmptyState icon={Group} title="Select a string or frame" />
          {/if}
        {:else}
          <ul class="flex flex-col gap-1">
            {#each selectedNodes as node (node.id)}
              <li
                class="flex items-center gap-2 rounded border border-border bg-bg px-2 py-1.5"
              >
                <div class="min-w-0 flex-1">
                  <div
                    class="truncate text-xs"
                    class:text-text-secondary={!node.key}
                    class:italic={!node.key}
                  >
                    {formatKeyLabel(node)}
                  </div>
                  <div
                    class="truncate text-[11px] text-text-secondary"
                    title={node.translation || node.characters}
                  >
                    {node.translation || node.characters || "—"}
                  </div>
                </div>
                <TooltipIconButton label="Move to string" onclick={() => showOnCanvas(node.id)}>
                  <Target size={ICON.inline} />
                </TooltipIconButton>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </Tooltip.Provider>
</div>
