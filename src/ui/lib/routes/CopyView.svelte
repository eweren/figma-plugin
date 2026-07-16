<script lang="ts">
  import { appState } from "$ui/lib/stores/app.svelte";
  import { Button, Card, Message } from "$ui/lib/components/ui";
  import ViewFooter from "$ui/lib/components/domain/ViewFooter.svelte";

  const language = $derived(appState.value.config?.language);
</script>

<div class="flex h-full flex-col">
  <header
    class="flex h-7 items-center justify-between bg-linear-to-b from-bg to-header-gradient-end border-b border-border px-3 py-2"
  >
    <h1 class="text-sm font-semibold">Copy page</h1>
  </header>

  <div class="flex-1 overflow-auto p-3 space-y-3">
    <Message variant="info">
      This page is a generated copy and won't be synchronised with Tolgee.
    </Message>

    <Card>
      <p class="text-xs">
        {#if language}
          Showing translations for <span class="font-mono">{language}</span>.
        {:else}
          Showing Tolgee keys instead of translated text.
        {/if}
      </p>
      <p class="mt-1 text-[11px] text-text-secondary">
        To make changes, switch to the original page or create a new copy.
      </p>
    </Card>
  </div>

  <ViewFooter>
    <Button
      variant="ghost"
      onclick={() => appState.navigate({ name: "settings" })}
    >
      Open settings
    </Button>
  </ViewFooter>
</div>
