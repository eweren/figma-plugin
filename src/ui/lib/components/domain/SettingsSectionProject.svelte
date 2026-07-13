<script lang="ts">
  import type { TolgeeConfig } from "$shared/types";
  import { ICON } from "$shared/iconSizes";
  import { auth } from "$ui/lib/stores/auth.svelte";
  import { appState } from "$ui/lib/stores/app.svelte";
  import { collectNamespaceNames } from "$ui/lib/logic/namespaces";
  import Select from "$ui/lib/components/ui/select.svelte";
  import NamespaceInput from "$ui/lib/components/ui/namespaceInput.svelte";
  import Label from "$ui/lib/components/ui/label.svelte";
  import * as Tooltip from "$ui/lib/components/ui/tooltip";
  import Info from "lucide-svelte/icons/info";

  const languageOptions = $derived(
    auth.value.languages.map((l) => ({ value: l.tag, label: l.name })),
  );

  // Server namespaces + any used locally (incl. just-created, not-yet-pushed).
  const namespaceNames = $derived(
    collectNamespaceNames(auth.value.namespaces, appState.value.selectedNodes),
  );

  type Props = { form: Partial<TolgeeConfig> };
  let { form = $bindable() }: Props = $props();
</script>

<section class="space-y-2.5">
  <h2 class="text-xs font-semibold uppercase tracking-wide text-primary">
    Language
  </h2>
  <div class="space-y-1">
    <Label for="settings-language">Current language</Label>
    <Select
      id="settings-language"
      bind:value={form.language}
      options={languageOptions}
      placeholder="Select language…"
      class="w-full"
    />
  </div>
</section>

<section class="space-y-2.5">
  <h2 class="text-xs font-semibold uppercase tracking-wide text-primary">
    Advanced
  </h2>

  {#if auth.value.namespacesEnabled}
    <div class="space-y-1">
      <div class="flex items-center gap-1.5">
        <Label for="settings-namespace">Default namespace</Label>
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <span
                  {...props}
                  class="text-text-secondary transition-colors hover:text-text-brand"
                  role="button"
                  tabindex={-1}
                  aria-label="What default namespace does"
                >
                  <Info size={ICON.inline} />
                </span>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content
              side="left"
              align="center"
              class="max-w-[16rem] leading-snug"
            >
              Applied to newly created keys. To change existing keys, select them
              and use bulk “Set namespace”.
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
      <NamespaceInput
        id="settings-namespace"
        value={form.namespace ?? ""}
        options={namespaceNames}
        onChange={(v) => (form.namespace = v)}
        class="w-full"
      />
    </div>
  {:else}
    <p class="flex items-center gap-1.5 text-[11px] text-text-secondary">
      <Info size={ICON.inline} class="text-icon-secondary" />
      Namespaces are disabled for this project
    </p>
  {/if}

  {#if !auth.value.branchingEnabled}
    <p class="flex items-center gap-1.5 text-[11px] text-text-secondary">
      <Info size={ICON.inline} class="text-icon-secondary" />
      Branching is disabled for this project
    </p>
  {/if}
</section>
