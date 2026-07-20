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

  type Props = {
    form: Partial<TolgeeConfig>;
    /** When true, drop the "… is disabled for this project" notes (and the
     *  whole Advanced section if it would then be empty). Used by the
     *  onboarding wizard to stay uncluttered; Settings keeps the notes. */
    hideDisabledNotes?: boolean;
  };
  let { form = $bindable(), hideDisabledNotes = false }: Props = $props();

  // Pre-fill "Current language" with the project's base language on first
  // setup (matches the original plugin), so the user isn't forced to pick it
  // manually. Runs once: only when no language is set yet and the base tag has
  // loaded; never overrides an existing choice.
  let languagePrefilled = false;
  $effect(() => {
    if (languagePrefilled) return;
    if (form.language) {
      languagePrefilled = true;
      return;
    }
    const base = auth.value.baseLanguage;
    if (base) {
      form.language = base;
      languagePrefilled = true;
    }
  });

  // Advanced section is worth showing when there's a real control in it (the
  // namespace input) or, in Settings, when a "disabled" note explains why
  // there isn't. Onboarding hides the notes, so it only appears with namespaces.
  const showAdvanced = $derived(
    auth.value.namespacesEnabled || !hideDisabledNotes,
  );
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

{#if showAdvanced}
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
  {:else if !hideDisabledNotes}
    <p class="flex items-center gap-1.5 text-[11px] text-text-secondary">
      <Info size={ICON.inline} class="text-icon-secondary" />
      Namespaces are disabled for this project
    </p>
  {/if}

  {#if !auth.value.branchingEnabled && !hideDisabledNotes}
    <p class="flex items-center gap-1.5 text-[11px] text-text-secondary">
      <Info size={ICON.inline} class="text-icon-secondary" />
      Branching is disabled for this project
    </p>
  {/if}
</section>
{/if}
