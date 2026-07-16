<script lang="ts">
  import { createQuery, useQueryClient } from "@tanstack/svelte-query";
  import type { FrameScreenshot, NodeInfo, TolgeeConfig } from "$shared/types";
  import { ICON } from "$shared/iconSizes";
  import { appState } from "$ui/lib/stores/app.svelte";
  import { auth } from "$ui/lib/stores/auth.svelte";
  import { nextCorrelationId, on, send } from "$ui/lib/bus";
  import { createIdleTimeout } from "$ui/lib/busRequest";
  import { Button, Card, Message, ProgressBar, Stat } from "$ui/lib/components/ui";
  import Badge from "$ui/lib/components/ui/badge.svelte";
  import CheckboxField from "$ui/lib/components/ui/checkboxField.svelte";
  import {
    pushDiff,
    buildRemoteMapFromKeys,
    textOfNode,
    type PushDiff,
  } from "$ui/lib/logic/pushDiff";
  import type { SimpleImportConflictResult } from "$ui/lib/api/push";
  import { fetchRemoteKeys } from "$ui/lib/api/keysByName";
  import {
    applyConfiguredTags,
    canonicalKey,
    defaultResolutions,
    fetchCanonicalAfterPush,
    resolutionKey,
    submitBigMeta,
    submitPush,
    uploadScreenshots,
    type PushContext,
  } from "$ui/lib/logic/pushFlow";
  import PushConflictItem from "$ui/lib/components/domain/PushConflictItem.svelte";
  import type { PushConflictResolution } from "$ui/lib/logic/pushFlow";
  import ViewHeader from "$ui/lib/components/domain/ViewHeader.svelte";
  import ViewFooter from "$ui/lib/components/domain/ViewFooter.svelte";
  import AlertTriangle from "lucide-svelte/icons/alert-triangle";

  type Stage = "idle" | "uploading" | "pushing" | "conflict" | "done" | "error";

  // ---- Local state -----------------------------------------------------------

  let stage = $state<Stage>("idle");
  let progress = $state<{
    current: number;
    total: number | null;
    message: string;
  }>({ current: 0, total: null, message: "" });
  // Progress for the diff-computation stage (`diffQuery`'s `fetchRemoteKeys`
  // call) — `total` is the key count known up front, `done` is the
  // cumulative count of names whose batch has resolved. Reset to `null`
  // whenever the query isn't pending, so it never lingers into the next
  // stage (see the `$effect` below).
  let diffProgress = $state<{ done: number; total: number } | null>(null);
  let conflicts = $state<SimpleImportConflictResult[]>([]);
  let resolutions = $state<Record<string, PushConflictResolution>>({});
  let errorMessage = $state<string | null>(null);
  let pushedKeyCount = $state(0);
  // Per-push screenshot toggle (default from settings, like the old plugin).
  // When checked the push uploads screenshots; it also keeps the Upload button
  // active when there are only screenshots to send (no text changes).
  // (Named `includeScreenshots` to avoid colliding with the imported
  // `uploadScreenshots` push-flow helper.)
  let includeScreenshots = $state(
    appState.value.config?.updateScreenshots ?? true,
  );

  // Section refs so the New/Changed stats can scroll their lists into view.
  let newSection = $state<HTMLElement>();
  let changedSection = $state<HTMLElement>();

  function scrollTo(el: HTMLElement | undefined): void {
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Derived ---------------------------------------------------------------

  const cfg = $derived<Partial<TolgeeConfig>>(appState.value.config ?? {});
  const language = $derived(cfg.language ?? "");
  // Only attach `branch` when the project actually has branching enabled —
  // otherwise Tolgee rejects with feature_not_enabled_for_project.
  const branch = $derived(auth.value.branchingEnabled ? cfg.branch : undefined);
  const hasNamespacesEnabled = $derived(auth.value.namespacesEnabled);
  const addTags = $derived(cfg.addTags ?? false);
  const configuredTags = $derived(cfg.tags ?? []);

  const selectedNodes = $derived<NodeInfo[]>(appState.value.selectedNodes);
  const connectedNodes = $derived(
    selectedNodes.filter((n) => n.key && n.key.trim().length > 0),
  );

  // Stable cache-key inputs for the diff query. We feed a sorted, joined
  // string instead of arrays so reference identity doesn't churn on re-renders
  // and svelte-query can dedupe correctly.
  const keyFilterCacheKey = $derived(
    Array.from(new Set(connectedNodes.map((n) => n.key)))
      .sort()
      .join(","),
  );
  const nsFilterCacheKey = $derived(
    hasNamespacesEnabled
      ? Array.from(new Set(connectedNodes.map((n) => n.ns ?? "")))
          .sort()
          .join(",")
      : "",
  );

  const qc = useQueryClient();

  /**
   * Diff query. Cached by (language, branch, key set, namespace set).
   * Selection-change re-runs hit the cache instantly; switching language
   * mid-load cancels the previous fetch through the AbortSignal.
   */
  const diffQuery = createQuery(() => ({
    queryKey: [
      "push-diff",
      language,
      branch ?? "",
      keyFilterCacheKey,
      nsFilterCacheKey,
    ],
    enabled:
      Boolean(auth.value.client) &&
      Boolean(language) &&
      connectedNodes.length > 0,
    staleTime: 5 * 1000,
    queryFn: async ({ signal }): Promise<PushDiff> => {
      const client = auth.value.client;
      if (!client) throw new Error("Not connected to Tolgee.");
      const filterKeyName = Array.from(
        new Set(connectedNodes.map((n) => n.key)),
      );
      const filterNamespace = hasNamespacesEnabled
        ? Array.from(new Set(connectedNodes.map((n) => n.ns ?? "")))
        : undefined;
      // `total` is known immediately (the name count) — seed it before the
      // first batch even resolves so the bar reads "0 / N" from the start
      // instead of flashing blank.
      diffProgress = { done: 0, total: filterKeyName.length };
      const remoteKeys = await fetchRemoteKeys(
        client,
        {
          filterKeyName,
          filterNamespace,
          language,
          branch: branch || undefined,
          signal,
        },
        (done, total) => {
          diffProgress = { done, total };
        },
      );
      const remoteMap = buildRemoteMapFromKeys(remoteKeys, language);
      return pushDiff(connectedNodes, remoteMap, {
        hasNamespacesEnabled,
        configuredTags,
      });
    },
  }));

  const diff = $derived(diffQuery.data ?? null);

  const noTextChanges = $derived(
    (diff?.newKeys.length ?? 0) === 0 && (diff?.changedKeys.length ?? 0) === 0,
  );
  // Any keys at all (incl. unchanged) → screenshots can be uploaded for them, so
  // the "Upload screenshots" toggle is offered.
  const hasAnyKeys = $derived(
    (diff?.newKeys.length ?? 0) +
      (diff?.changedKeys.length ?? 0) +
      (diff?.unchangedKeys.length ?? 0) >
      0,
  );
  // Even with no text changes, screenshots can still be (re)uploaded for the
  // existing keys, matching the old plugin. This keeps the Upload button active
  // in that case (the push already includes unchangedKeys + their screenshots).
  const screenshotOnlyUpload = $derived(
    noTextChanges &&
      includeScreenshots &&
      (diff?.unchangedKeys.length ?? 0) > 0,
  );

  function buildContext(): PushContext | null {
    const client = auth.value.client;
    if (!client) return null;
    return {
      client,
      apiUrl: auth.value.apiUrl,
      apiKey: auth.value.apiKey,
      language,
      branch: branch || undefined,
      hasNamespacesEnabled,
    };
  }

  function backToIndex(): void {
    appState.navigate({ name: "index" });
  }

  // ---- Screenshot capture (UI -> main via bus) ------------------------------

  // Idle timeout (not a wall-clock cap): large exports can legitimately take
  // a while, but each frame that streams in resets the timer, so this only
  // fires if NOTHING has arrived for a full 5 minutes straight. 5 minutes
  // (not 120s) because a single pathologically large frame — e.g. a
  // design-system wall spanning tens of thousands of layers, which testing
  // on this project has actually hit — can itself take a while to export,
  // with no intermediate progress message during that one export.
  const SCREENSHOTS_TIMEOUT_MS = 5 * 60_000;

  function captureScreenshots(nodeIds: string[]): Promise<FrameScreenshot[]> {
    return new Promise((resolve, reject) => {
      if (nodeIds.length === 0) {
        resolve([]);
        return;
      }
      const correlationId = nextCorrelationId();
      // Frames stream in one message each (main-side memory + serialization
      // stay bounded); `screenshots-done` closes the stream.
      const collected: FrameScreenshot[] = [];
      const cleanup = (): void => {
        offFrame();
        offDone();
        watchdog.clear();
      };
      const watchdog = createIdleTimeout(SCREENSHOTS_TIMEOUT_MS, () => {
        cleanup();
        reject(new Error("Timed out waiting for screenshots to be captured."));
      });
      const offFrame = on("screenshot-frame", (msg) => {
        if (msg.correlationId !== correlationId) return;
        watchdog.touch();
        collected.push(msg.screenshot);
      });
      const offDone = on("screenshots-done", (msg) => {
        if (msg.correlationId !== correlationId) return;
        cleanup();
        resolve(collected);
      });
      send({ type: "request-screenshots", correlationId, nodeIds });
    });
  }

  // ---- Push flow -------------------------------------------------------------

  function nodesToPushFrom(d: PushDiff): NodeInfo[] {
    return [
      ...d.newKeys,
      ...d.changedKeys.map((c) => c.node),
      ...d.unchangedKeys,
    ];
  }

  async function startPush(): Promise<void> {
    const ctx = buildContext();
    if (!ctx) {
      errorMessage = "Not connected to Tolgee.";
      stage = "error";
      return;
    }
    if (!diff) return;
    if (!language) {
      errorMessage = "No language configured.";
      stage = "error";
      return;
    }

    errorMessage = null;
    pushedKeyCount = 0;
    const nodesToPush = nodesToPushFrom(diff);
    // Screenshots cover EVERY layer of each pushed key (all frames it appears
    // on), not just the deduped representative — so a key reused across frames
    // keeps full screenshot coverage, like the original plugin. Scoped to the
    // pushed keys so we never export a frame that only holds keys we're not
    // pushing (no wasted exports). `mapScreenshotsForNode` attaches them by key.
    const pushedKeys = new Set(nodesToPush.map((n) => resolutionKey(n.key, n.ns)));
    const screenshotNodes = connectedNodes.filter((n) =>
      pushedKeys.has(resolutionKey(n.key, n.ns)),
    );

    try {
      let screenshots: FrameScreenshot[] = [];
      let uploadedById = new Map<FrameScreenshot, number>();

      if (includeScreenshots && screenshotNodes.length > 0) {
        stage = "uploading";
        progress = {
          current: 0,
          total: null,
          message: "Capturing screenshots…",
        };
        screenshots = await captureScreenshots(screenshotNodes.map((n) => n.id));
        uploadedById = await uploadScreenshots(ctx, screenshots, (e) => {
          progress = e;
        });
      }

      stage = "pushing";
      progress = {
        current: 0,
        total: null,
        message: "Uploading translations…",
      };

      const result = await submitPush({
        ctx,
        nodes: nodesToPush,
        screenshots,
        uploadedImageIdByScreenshot: uploadedById,
        resolutionMode: "RECOMMENDED",
        // Unchanged keys ride along only to carry screenshots — never re-push
        // (override) their untouched translation. Matches the original plugin.
        unchangedNodeIds: new Set(diff.unchangedKeys.map((n) => n.id)),
      });

      if (result.unresolvedConflicts.length > 0) {
        conflicts = result.unresolvedConflicts;
        resolutions = defaultResolutions(result.unresolvedConflicts);
        stage = "conflict";
        return;
      }

      // Register screenshot key-context for in-context suggestions (best-effort,
      // never fails the push). Only when screenshots were actually uploaded.
      if (includeScreenshots && screenshots.length > 0) {
        await submitBigMeta(ctx, screenshots);
      }

      await finishPush(ctx, nodesToPush);
    } catch (err) {
      handlePushError(err);
    }
  }

  async function applyResolutions(): Promise<void> {
    const ctx = buildContext();
    if (!ctx || !diff) return;
    errorMessage = null;

    const nodesByKey = new Map<string, NodeInfo>();
    for (const n of nodesToPushFrom(diff)) {
      nodesByKey.set(resolutionKey(n.key, n.ns), n);
    }

    const subset: NodeInfo[] = [];
    for (const c of conflicts) {
      const node = nodesByKey.get(resolutionKey(c.keyName, c.keyNamespace));
      if (node) subset.push(node);
    }

    try {
      stage = "pushing";
      progress = {
        current: 0,
        total: null,
        message: "Re-submitting with resolutions…",
      };

      const result = await submitPush({
        ctx,
        nodes: subset,
        screenshots: [],
        uploadedImageIdByScreenshot: new Map(),
        resolutionMode: "FORCE_OVERRIDE",
        resolutionFor: (k, ns) => resolutions[resolutionKey(k, ns)] ?? "KEEP",
      });

      conflicts = result.unresolvedConflicts;
      if (conflicts.length > 0) {
        resolutions = defaultResolutions(conflicts);
        stage = "conflict";
        return;
      }

      await finishPush(ctx, nodesToPushFrom(diff));
    } catch (err) {
      handlePushError(err);
    }
  }

  function handlePushError(err: unknown): void {
    errorMessage = (err as Error)?.message ?? "Upload failed.";
    stage = "error";
    appState.setError({
      message: errorMessage,
      severity: "error",
    });
  }

  async function finishPush(
    ctx: PushContext,
    allNodes: NodeInfo[],
  ): Promise<void> {
    pushedKeyCount =
      (diff?.newKeys.length ?? 0) + (diff?.changedKeys.length ?? 0);

    // Best-effort: tag failures must not undo the push.
    if (addTags && configuredTags.length > 0) {
      try {
        await applyConfiguredTags({
          ctx,
          tags: configuredTags,
          nodes: allNodes,
        });
      } catch (err) {
        appState.setError({
          message: `Translations were pushed, but tag update failed: ${
            (err as Error)?.message ?? "unknown error"
          }`,
          severity: "warning",
        });
      }
    }

    const canonical = await fetchCanonicalAfterPush(ctx, allNodes).catch(
      () => null,
    );

    // Connect EVERY selected node that shares a pushed key — not just the
    // per-key representative `pushDiff` kept. Without this, bulk-assigning one
    // key to several identical strings would upload the key but leave all but
    // the first node unconnected ("not all my keys uploaded"). Nodes share a
    // `(key, ns)` so they all resolve to the same canonical entry. We exclude
    // the dropped members of CONFLICTING groups (same key, different text):
    // only their first node was actually pushed.
    const droppedConflictIds = new Set(
      (diff?.conflictingNodes ?? []).flatMap((g) =>
        g.nodes.slice(1).map((n) => n.id),
      ),
    );
    // Missing keys (deleted on the platform) were intentionally NOT pushed —
    // don't re-mark them connected, they need reconnecting/removing.
    const missingIds = new Set((diff?.missingKeys ?? []).map((n) => n.id));
    const nodesToConnect = connectedNodes.filter(
      (n) => !droppedConflictIds.has(n.id) && !missingIds.has(n.id),
    );

    send({
      type: "set-nodes-data",
      correlationId: nextCorrelationId(),
      nodes: nodesToConnect.map((n) => {
        const remote = canonical?.get(canonicalKey(n));
        return {
          id: n.id,
          info: {
            connected: true,
            translation: remote?.translation ?? n.translation ?? n.characters,
            isPlural: remote?.isPlural ?? n.isPlural,
          },
        };
      }),
    });

    send({
      type: "notify",
      text: `Uploaded ${pushedKeyCount} key(s) to Tolgee`,
    });
    // Drop the diff cache so the next visit recomputes against the new
    // canonical translations.
    void qc.invalidateQueries({ queryKey: ["push-diff"] });
    stage = "done";
  }

  function handleResolutionChange(
    keyName: string,
    ns: string | undefined,
    resolution: PushConflictResolution,
  ): void {
    resolutions = {
      ...resolutions,
      [resolutionKey(keyName, ns)]: resolution,
    };
  }

  // Lookup helpers used by the conflict UI to show both sides side-by-side.
  function figmaTextFor(c: SimpleImportConflictResult): string {
    const target = diff
      ? nodesToPushFrom(diff).find(
          (n) => n.key === c.keyName && (n.ns ?? "") === (c.keyNamespace ?? ""),
        )
      : undefined;
    return target ? target.translation || target.characters || "" : "";
  }

  function remoteTextFor(c: SimpleImportConflictResult): string {
    const changed = diff?.changedKeys.find(
      (x) =>
        x.node.key === c.keyName &&
        (x.node.ns ?? "") === (c.keyNamespace ?? ""),
    );
    return changed?.remoteText ?? "";
  }

  // Map diff-query error to the user-facing banner.
  $effect(() => {
    const err = diffQuery.error;
    if (err) {
      errorMessage = (err as Error)?.message ?? "Failed to compute diff.";
      stage = "error";
    }
  });

  // The diff-computation progress bar only means something while the query
  // is actually in flight — clear it the moment it settles (success or
  // error) so it doesn't linger once the diff card / error banner replaces
  // the "Computing changes…" state.
  $effect(() => {
    if (!diffQuery.isPending) {
      diffProgress = null;
    }
  });
</script>

<div class="flex h-full flex-col">
  <ViewHeader
    title="Upload to Tolgee"
    subtitle={language ? `(${language})` : undefined}
    onBack={backToIndex}
  />

  <div class="flex-1 overflow-auto p-3 space-y-3">
    {#if diffQuery.isPending}
      <Card>
        <ProgressBar
          loaded={diffProgress?.done ?? 0}
          total={diffProgress?.total ?? null}
          label="Computing changes…"
        />
      </Card>
    {:else if stage === "error"}
      <div class="bg-red-100 text-red-900 p-2 text-sm rounded">
        {errorMessage ?? "An error occurred."}
      </div>
    {:else if stage === "done"}
      <Card>
        <p class="text-sm">
          Uploaded {pushedKeyCount} key(s) to Tolgee.
        </p>
      </Card>
    {:else if stage === "uploading" || stage === "pushing"}
      <div class="flex flex-col gap-2 rounded-md border border-border p-3">
        <ProgressBar
          loaded={progress.current}
          total={progress.total}
          label={progress.message || "Working…"}
        />
        <div class="flex justify-end">
          <Button variant="ghost" size="sm" disabled aria-label="Cancel">
            Cancel
          </Button>
        </div>
      </div>
    {:else if stage === "conflict"}
      <Card>
        <div class="flex items-center gap-2 text-xs text-text">
          <AlertTriangle size={ICON.inline} />
          <span class="font-medium">
            {conflicts.length} unresolved conflict(s)
          </span>
        </div>
        <p class="mt-1 text-[11px] text-text-secondary">
          Pick a resolution for each conflict and re-submit.
        </p>
        <div class="mt-2">
          {#each conflicts as conflict (conflict.keyName + (conflict.keyNamespace ?? "") + conflict.language)}
            <PushConflictItem
              keyName={conflict.keyName}
              keyNamespace={conflict.keyNamespace}
              language={conflict.language}
              figmaText={figmaTextFor(conflict)}
              remoteText={remoteTextFor(conflict)}
              isOverridable={conflict.isOverridable}
              resolution={resolutions[
                resolutionKey(conflict.keyName, conflict.keyNamespace)
              ] ?? (conflict.isOverridable ? "OVERRIDE" : "KEEP")}
              onResolutionChange={handleResolutionChange}
            />
          {/each}
        </div>
      </Card>
    {:else if diff}
      {#if diff.conflictingNodes.length > 0}
        <div
          class="rounded-md border border-yellow-400/40 bg-yellow-100 p-2 text-xs text-yellow-900"
        >
          <div class="flex items-start gap-1.5">
            <AlertTriangle size={ICON.inline} class="mt-0.5 shrink-0" />
            <div>
              <div class="font-semibold">
                {diff.conflictingNodes.length} key(s) reuse the same name with different
                text in Figma.
              </div>
              <p class="opacity-80">
                Only the first occurrence will be pushed for each. Update or
                disconnect the duplicates to clear this warning.
              </p>
              <ul class="mt-1 list-disc pl-4">
                {#each diff.conflictingNodes as group (group.key + (group.ns ?? ""))}
                  <li>
                    <span class="font-mono">{group.key}</span>
                    {#if hasNamespacesEnabled}
                      <span class="opacity-70">ns:{group.ns || "<none>"}</span>
                    {/if}
                    <span class="opacity-70">
                      ({group.nodes.length} nodes)
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          </div>
        </div>
      {/if}

      {#if diff.missingKeys.length > 0}
        <Message variant="error" class="items-start! gap-2">
          <div class="flex flex-col gap-1">
            <div class="font-semibold">
              {diff.missingKeys.length} connected key(s) no longer exist in Tolgee.
            </div>
            <p class="opacity-80">
              They were deleted on the platform, so they'll be skipped (not
              re-created). Reconnect them to an existing key or remove the layer.
            </p>
            <ul class="mt-1 list-disc pl-4">
              {#each diff.missingKeys as n (n.id)}
                <li>
                  <span class="font-mono">{n.key}</span>
                  {#if hasNamespacesEnabled}
                    <span class="opacity-70">ns:{n.ns || "<none>"}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        </Message>
      {/if}

      <Card class="border-0 bg-bg-secondary">
        <div class="grid grid-cols-3 gap-2">
          <!-- New / Changed scroll to their lists when there's something there;
               Unchanged has no list, so it stays static. -->
          <Stat
            value={diff.newKeys.length}
            label="New"
            tone="secondary"
            onclick={diff.newKeys.length > 0
              ? () => scrollTo(newSection)
              : undefined}
          />
          <Stat
            value={diff.changedKeys.length}
            label="Changed"
            tone="brand"
            onclick={diff.changedKeys.length > 0
              ? () => scrollTo(changedSection)
              : undefined}
          />
          <Stat
            value={diff.unchangedKeys.length}
            label="Unchanged"
            tone="muted"
          />
        </div>
      </Card>

      {#if hasAnyKeys}
        <!-- Per-push screenshot toggle in a card so it stays visible — when
             there are no text changes it's the ONLY action, so it must stand out
             (the Upload button stays active while it's on). -->
        <div class="rounded-md border border-border bg-bg-secondary px-3 py-2.5">
          <CheckboxField
            label="Upload screenshots"
            checked={includeScreenshots}
            onChange={(v) => (includeScreenshots = v)}
          />
          {#if noTextChanges && includeScreenshots}
            <p class="mt-1 pl-6 text-[11px] text-text-secondary">
              No text changes — screenshots will still be uploaded for
              {diff.unchangedKeys.length}
              {diff.unchangedKeys.length === 1 ? "key" : "keys"}.
            </p>
          {/if}
        </div>
      {/if}

      {#if noTextChanges && !screenshotOnlyUpload}
        <p class="text-center text-xs text-text-secondary">
          No changes to upload.
        </p>
      {/if}

      {#if diff.newKeys.length > 0}
        <section bind:this={newSection} class="scroll-mt-2">
          <div
            class="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-secondary"
          >
            New ({diff.newKeys.length})
          </div>
          <ul class="space-y-1">
            {#each diff.newKeys as node (node.id)}
              <li class="rounded border border-border bg-bg p-2">
                <div class="flex items-center gap-1.5">
                  <span class="min-w-0 truncate text-xs font-mono">{node.key}</span>
                  {#if hasNamespacesEnabled}
                    <Badge>ns:{node.ns || "<none>"}</Badge>
                  {/if}
                </div>
                <div class="truncate text-[11px] text-text-secondary">
                  {textOfNode(node)}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if diff.changedKeys.length > 0}
        <section bind:this={changedSection} class="scroll-mt-2">
          <div
            class="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-secondary"
          >
            Changed ({diff.changedKeys.length})
          </div>
          <ul class="space-y-1">
            {#each diff.changedKeys as entry (entry.node.id)}
              <li class="rounded border border-border bg-bg p-2">
                <div class="flex items-center gap-1.5">
                  <span class="min-w-0 truncate text-xs font-mono">
                    {entry.node.key}
                  </span>
                  {#if hasNamespacesEnabled}
                    <Badge>ns:{entry.node.ns || "<none>"}</Badge>
                  {/if}
                </div>
                <div
                  class="truncate text-[11px] text-text-secondary line-through"
                  title={entry.remoteText}
                >
                  {entry.remoteText}
                </div>
                <div class="truncate text-[11px] text-text">
                  {textOfNode(entry.node)}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  </div>

  <ViewFooter>
    {#if stage === "conflict"}
      <Button variant="ghost" onclick={backToIndex}>Cancel</Button>
      <Button onclick={applyResolutions}>Apply resolutions</Button>
    {:else if stage === "done" || stage === "error"}
      <Button onclick={backToIndex}>OK</Button>
    {:else if stage === "idle" && diff}
      <Button variant="ghost" onclick={backToIndex}>Cancel</Button>
      <Button onclick={startPush} disabled={noTextChanges && !screenshotOnlyUpload}>
        Upload to Tolgee
      </Button>
    {/if}
  </ViewFooter>
</div>
