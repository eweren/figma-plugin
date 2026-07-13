<script lang="ts">
  import { Input } from "$ui/lib/components/ui";
  import Badge from "$ui/lib/components/ui/badge.svelte";
  import { auth } from "$ui/lib/stores/auth.svelte";
  import { appState } from "$ui/lib/stores/app.svelte";
  import { searchKeys, type KeySearchResult } from "$ui/lib/api/keys";

  type Props = {
    onSelect: (key: string, ns: string | null) => void;
  };

  let { onSelect }: Props = $props();

  let query = $state("");
  let results = $state<KeySearchResult[]>([]);
  let loading = $state(false);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const q = query;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    const client = auth.value.client;
    if (!q.trim() || !client) {
      results = [];
      loading = false;
      return;
    }
    loading = true;
    timeoutId = setTimeout(async () => {
      try {
        results = await searchKeys(
          client,
          q,
          appState.value.config?.language,
          20,
        );
      } catch {
        results = [];
      } finally {
        loading = false;
      }
    }, 300);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
  });
</script>

<div class="space-y-2">
  <Input
    bind:value={query}
    placeholder="Search existing keys…"
    data-cy="key-search-input"
  />
  {#if loading}
    <p class="text-xs text-text-secondary">Searching…</p>
  {:else if query.trim() && results.length === 0}
    <p class="text-xs text-text-secondary">No keys found.</p>
  {:else if results.length > 0}
    <ul
      class="border border-border rounded divide-y divide-border max-h-40 overflow-auto"
    >
      {#each results as r (r.id)}
        <li>
          <button
            type="button"
            class="w-full text-left px-2 py-1 hover:bg-(--figma-color-bg-hover)"
            onclick={() => onSelect(r.name, r.namespace)}
          >
            <div class="flex items-center gap-1.5">
              <span class="min-w-0 truncate text-xs font-medium">{r.name}</span>
              <!-- Always show the key's namespace, incl. an explicit "<none>". -->
              <Badge>ns:{r.namespace || "<none>"}</Badge>
            </div>
            {#if r.translation || r.baseTranslation}
              <div class="text-[10px] text-text-secondary truncate">
                {r.translation ?? r.baseTranslation}
              </div>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
