<script lang="ts">
  import { onMount } from "svelte";
  import { ICON } from "$shared/iconSizes";
  import { send, on, nextCorrelationId } from "$ui/lib/bus";
  import Switch from "$ui/lib/components/ui/switch.svelte";
  import Label from "$ui/lib/components/ui/label.svelte";
  import * as Tooltip from "$ui/lib/components/ui/tooltip";
  import Info from "lucide-svelte/icons/info";

  // Annotation state lives in clientStorage (main thread), NOT in the config
  // form — so this toggle applies LIVE (main syncs/clears on receipt), separate
  // from the Settings Save button.
  let enabled = $state(false);
  let available = $state(true);
  let loading = $state(true);

  onMount(() => {
    const correlationId = nextCorrelationId();
    const off = on("annotations-state", (msg) => {
      if (msg.correlationId !== correlationId) return;
      enabled = msg.enabled;
      available = msg.available;
      loading = false;
      off();
    });
    send({ type: "get-annotations-state", correlationId });
    return off;
  });

  function toggle(v: boolean): void {
    enabled = v;
    send({ type: "toggle-annotations", enabled: v });
  }
</script>

<Tooltip.Provider delayDuration={200}>
  <section class="space-y-2.5">
    <h2 class="text-xs font-semibold uppercase tracking-wide text-primary">
      Canvas annotations
    </h2>

    {#if !available}
      <p class="flex items-center gap-1.5 text-[11px] text-text-secondary">
        <Info size={ICON.inline} class="text-icon-secondary" />
        Annotations aren't available in Dev Mode.
      </p>
    {:else}
      <div class="flex items-center gap-2">
        <Switch id="annotations-toggle" checked={enabled} onCheckedChange={toggle} />
        <div class="flex items-center gap-1.5">
          <Label for="annotations-toggle">Key annotations on canvas</Label>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <span
                  {...props}
                  class="text-text-secondary transition-colors hover:text-text-brand"
                  role="button"
                  tabindex={-1}
                  aria-label="What key annotations do"
                >
                  <Info size={ICON.inline} />
                </span>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="left" align="center" class="max-w-[15rem] leading-snug">
              Annotations of connected strings with their Tolgee key. Turn off
              to remove them.
            </Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>
    {/if}

    {#if loading}
      <p class="text-[11px] text-text-secondary">Loading…</p>
    {/if}
  </section>
</Tooltip.Provider>
