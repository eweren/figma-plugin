<script lang="ts">
  import { onMount } from "svelte";
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { appState } from "./lib/stores/app.svelte";
  import { auth } from "./lib/stores/auth.svelte";
  import { queryClient } from "./lib/stores/query.svelte";
  import { attachBus, on, send } from "./lib/bus";
  import { flushNodeSaves } from "./lib/logic/saveQueue";
  import { validateApiKey } from "./lib/api/auth";
  import { createTolgeeClient } from "./lib/api/client";
  import { getProjectMeta } from "./lib/api/projectMeta";
  import IndexView from "./lib/routes/Index.svelte";
  import PageSetup from "./lib/routes/PageSetup.svelte";
  import CopyView from "./lib/routes/CopyView.svelte";
  import Settings from "./lib/routes/Settings.svelte";
  import Push from "./lib/routes/Push.svelte";
  import Pull from "./lib/routes/Pull.svelte";
  import Connect from "./lib/routes/Connect.svelte";
  import StringDetails from "./lib/routes/StringDetails.svelte";
  import CreateCopy from "./lib/routes/CreateCopy.svelte";
  import ErrorBanner from "./lib/components/domain/ErrorBanner.svelte";
  import ResizeHandle from "./lib/components/domain/ResizeHandle.svelte";
  import type { TolgeeConfig } from "$shared/types";

  // Validate the stored credentials silently on startup so the rest of the
  // app reflects "authenticated" state without forcing the user back to
  // Settings just to click Test Connection.
  let lastValidated: string | null = null;
  async function maybeBootstrapAuth(
    config: Partial<TolgeeConfig> | null,
  ): Promise<void> {
    const apiUrl = config?.apiUrl;
    const apiKey = config?.apiKey;
    if (!apiUrl || !apiKey) {
      if (auth.value.authenticated) auth.clear();
      lastValidated = null;
      return;
    }
    const fingerprint = `${apiUrl}::${apiKey}`;
    if (fingerprint === lastValidated) return;
    lastValidated = fingerprint;
    const result = await validateApiKey(apiUrl, apiKey);
    if (!result.ok) {
      if (auth.value.authenticated) auth.clear();
      return;
    }
    const client = createTolgeeClient(apiUrl, apiKey);
    auth.setAuth({
      client,
      apiUrl,
      apiKey,
      projectId: result.projectId,
      scopes: result.scopes,
    });
    if (config?.projectId !== result.projectId) {
      send({ type: "persist-project-id", projectId: result.projectId });
    }
    // Hydrate project-level feature flags (branching, namespaces) so push /
    // pull can decide whether to send `branch` and how to surface namespaces.
    try {
      const meta = await getProjectMeta(apiUrl, apiKey, result.projectId);
      auth.setProjectFeatures({
        branchingEnabled: meta.branchingEnabled,
        namespacesEnabled: meta.namespacesFeaturesEnabled,
        projectName: meta.name,
      });
    } catch {
      auth.setProjectFeatures({
        branchingEnabled: false,
        namespacesEnabled: false,
      });
    }
    // Hydrate the language and namespace pickers so the header dropdowns are
    // populated for every route without each one re-fetching. Errors are
    // swallowed — the UI gracefully falls back to "current value only".
    void hydratePickers(client);
  }

  async function hydratePickers(
    client: ReturnType<typeof createTolgeeClient>,
  ): Promise<void> {
    try {
      const { data } = await client.GET("/v2/projects/languages", {
        params: { query: { size: 1000 } },
      });
      const raw = data as {
        _embedded?: { languages?: Array<{ tag?: string; name?: string }> };
      };
      const list = raw._embedded?.languages ?? [];
      auth.setLanguages(
        list
          .filter((l): l is { tag: string; name?: string } => Boolean(l.tag))
          .map((l) => ({ tag: l.tag, name: l.name ?? l.tag })),
      );
    } catch {
      auth.setLanguages([]);
    }
    try {
      const { data } = await client.GET("/v2/projects/used-namespaces", {});
      const raw = data as {
        _embedded?: { namespaces?: Array<{ name?: string }> };
      };
      const list = raw._embedded?.namespaces ?? [];
      auth.setNamespaces(
        list
          .filter((n): n is { name: string } => Boolean(n.name))
          .map((n) => ({ name: n.name })),
      );
    } catch {
      auth.setNamespaces([]);
    }
  }

  onMount(() => {
    attachBus();
    let initReceived = false;
    const unsubInit = on("init", (msg) => {
      initReceived = true;
      appState.setConfig(msg.config);
      appState.setSelection(msg.selectedNodes, msg.hasUserSelection);
      appState.setEditorType(msg.editorType);
      if (msg.initialRoute) {
        appState.navigate({ name: msg.initialRoute } as import("$shared/types").Route);
      }
      void maybeBootstrapAuth(msg.config);
    });
    const unsubPending = on("selection-pending", () => appState.setScanning());
    const unsubSel = on("selection-changed", (msg) =>
      appState.setSelection(msg.nodes, msg.hasUserSelection),
    );
    // Streamed variant — large scans arrive in batches so the list renders
    // long before the whole selection is processed (`selection-changed`
    // stays for non-streamed senders: init and the e2e host).
    const unsubBatch = on("selection-batch", (msg) =>
      appState.appendSelection(msg.nodes, msg.first),
    );
    const unsubDone = on("selection-done", (msg) =>
      appState.finalizeSelection(msg.hasUserSelection, msg.total),
    );
    const unsubCfg = on("config-changed", (msg) => {
      appState.setConfig(msg.config);
      void maybeBootstrapAuth(msg.config);
    });
    const unsubPage = on("page-changed", (msg) => {
      appState.setConfig(msg.config);
      void maybeBootstrapAuth(msg.config);
    });
    const unsubCmd = on("command", (_msg) => {
      // TODO: route commands (open / open-on-node)
    });
    // Writes no longer trigger a whole-selection re-scan on the main thread;
    // instead their results carry fresh snapshots of just the written nodes.
    // Patch them into the selection here so every write path (inline edits,
    // bulk actions, Pull, StringDetails) stays consistent for free.
    // Bulk-write progress for Index's top progress bar / busy action bar — no
    // correlationId pairing, see `nodes-set-progress` and `writeProgress`.
    const unsubWriteProgress = on("nodes-set-progress", (msg) =>
      appState.setWriteProgress(msg.done, msg.total),
    );
    const unsubNodesSet = on("nodes-set-result", (msg) => {
      appState.patchNodes(msg.nodes);
      appState.clearWriteProgress();
    });
    const unsubApplied = on("apply-translations-result", (msg) => appState.patchNodes(msg.nodes));
    // Figma can tear the iframe down at any moment — persist any debounced
    // inline edits so the last ~300ms of typing isn't silently lost.
    const flushOnHide = () => flushNodeSaves();
    window.addEventListener("pagehide", flushOnHide);
    // Retry sending ui-ready until the host acknowledges with init.
    // Guards against the race where the host's listener isn't registered yet.
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRetry = () => {
      retryTimer = setTimeout(() => {
        if (!initReceived) {
          send({ type: "ui-ready" });
          scheduleRetry();
        }
      }, 400);
    };
    send({ type: "ui-ready" });
    scheduleRetry();
    return () => {
      clearTimeout(retryTimer);
      unsubInit();
      unsubPending();
      unsubSel();
      unsubBatch();
      unsubDone();
      unsubCfg();
      unsubPage();
      unsubCmd();
      unsubWriteProgress();
      unsubNodesSet();
      unsubApplied();
      window.removeEventListener("pagehide", flushOnHide);
    };
  });

</script>

<QueryClientProvider client={queryClient}>
  <div class="relative flex flex-col h-screen text-text">
    {#if appState.value.errorBanner}
      <ErrorBanner banner={appState.value.errorBanner} />
    {/if}
    <main class="flex-1 overflow-auto">
      {#if appState.value.route.name === "settings"}
        <!-- Settings is always reachable, even before the page is set up. -->
        <Settings />
      {:else if appState.value.config?.pageCopy}
        <!-- Copy pages bypass the PageSetup gate — they are always ready. -->
        <CopyView />
      {:else if !appState.value.config?.pageInfo && appState.value.config?.documentInfo}
        <!-- PageSetup gate: document is configured but page is not. -->
        <PageSetup />
      {:else if appState.value.route.name === "index"}
        <IndexView />
      {:else if appState.value.route.name === "pageSetup"}
        <PageSetup />
      {:else if appState.value.route.name === "copyView"}
        <CopyView />
      {:else if appState.value.route.name === "push"}
        <Push />
      {:else if appState.value.route.name === "pull"}
        <Pull />
      {:else if appState.value.route.name === "connect"}
        <Connect />
      {:else if appState.value.route.name === "stringDetails"}
        <StringDetails />
      {:else if appState.value.route.name === "createCopy"}
        <CreateCopy />
      {/if}
    </main>
    <ResizeHandle />
  </div>
</QueryClientProvider>
