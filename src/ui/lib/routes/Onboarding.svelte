<script lang="ts">
  import type { TolgeeConfig } from "$shared/types";
  import { ICON } from "$shared/iconSizes";
  import { appState } from "$ui/lib/stores/app.svelte";
  import { auth } from "$ui/lib/stores/auth.svelte";
  import { send } from "$ui/lib/bus";
  import { Button } from "$ui/lib/components/ui";
  import ArrowRight from "lucide-svelte/icons/arrow-right";
  import ArrowLeft from "lucide-svelte/icons/arrow-left";
  import Check from "lucide-svelte/icons/check";
  import SettingsSectionConnection from "$ui/lib/components/domain/SettingsSectionConnection.svelte";
  import SettingsSectionProject from "$ui/lib/components/domain/SettingsSectionProject.svelte";
  import SettingsSectionKeys from "$ui/lib/components/domain/SettingsSectionKeys.svelte";
  import SettingsSectionSync from "$ui/lib/components/domain/SettingsSectionSync.svelte";
  import SettingsSectionPush from "$ui/lib/components/domain/SettingsSectionPush.svelte";

  const DEFAULT_API_URL = "https://app.tolgee.io";

  // First-run guided setup. Deliberately the SAME sections Settings uses,
  // one step at a time — no duplicated fields, so a settings change lands here
  // too. Matches the original plugin's stepped setup (Project → Strings → Push).
  const TITLES = ["Connect", "Strings and keys", "Upload to Tolgee"] as const;
  // Short labels for the compact stepper (the step body carries the full
  // section headings anyway).
  const STEP_LABELS = ["Connect", "Strings & keys", "Upload"] as const;
  let step = $state(0);

  // Same form snapshot + defaults as Settings, so the sections behave
  // identically and the final Save writes exactly what Settings would.
  const cfg = appState.value.config ?? {};
  let form = $state<Partial<TolgeeConfig>>({
    ...cfg,
    apiUrl: cfg.apiUrl ?? DEFAULT_API_URL,
    apiKey: cfg.apiKey ?? "",
    namespace: cfg.namespace ?? "",
    language: cfg.language ?? "",
    ignorePrefix: cfg.ignorePrefix ?? "_",
  });

  // Can't move past "Connect" until the credentials actually validated —
  // everything downstream (languages, namespaces, push tags) needs a project.
  const canAdvance = $derived(step > 0 || auth.value.authenticated);

  function next(): void {
    if (step < TITLES.length - 1) step += 1;
    else finish();
  }
  function back(): void {
    if (step > 0) step -= 1;
  }

  function finish(): void {
    // Identical to Settings.save: persist, mirror locally, land on Index.
    // `save-config` stamps documentInfo on the main side, so this first-run
    // gate won't fire again for this document.
    send({ type: "save-config", config: form });
    appState.setConfig({ ...(appState.value.config ?? {}), ...form });
    appState.navigate({ name: "index" });
  }
</script>

<div class="flex h-full flex-col">
  <header
    class="shrink-0 border-b border-border bg-linear-to-b from-bg to-header-gradient-end px-3 py-2.5"
  >
    <!-- No title/logo here — Figma's own plugin chrome already shows the
         Tolgee logo + name above this iframe. Just the stepper. -->
    <!-- Simple stepper: numbered circles joined by rounded, inset connectors,
         UPPERCASE titles below. -->
    <div class="flex py-1">
      {#each STEP_LABELS as label, i (i)}
        <div class="flex flex-1 flex-col items-center">
          <div class="relative flex h-7 w-full items-center justify-center">
            {#if i > 0}
              <!-- left connector: inset from the circle (gap) + rounded ends. -->
              <div
                class="absolute left-0 top-1/2 h-[3px] w-[calc(50%-1.375rem)] -translate-y-1/2 rounded-full transition-colors"
                class:bg-bg-brand={i <= step}
                class:bg-border={i > step}
              ></div>
            {/if}
            {#if i < STEP_LABELS.length - 1}
              <div
                class="absolute right-0 top-1/2 h-[3px] w-[calc(50%-1.375rem)] -translate-y-1/2 rounded-full transition-colors"
                class:bg-bg-brand={i < step}
                class:bg-border={i >= step}
              ></div>
            {/if}
            <div
              class="relative z-10 flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors"
              class:border-transparent={i <= step}
              class:bg-bg-brand={i <= step}
              class:text-text-onbrand={i <= step}
              class:border-border={i > step}
              class:bg-bg={i > step}
              class:text-text-secondary={i > step}
            >
              {#if i < step}
                <Check size={14} />
              {:else}
                {i + 1}
              {/if}
            </div>
          </div>
          <span
            class="mt-1.5 text-center text-[11px] uppercase leading-tight tracking-wide"
            class:font-semibold={i <= step}
            class:text-text={i <= step}
            class:text-text-secondary={i > step}
          >
            {label}
          </span>
        </div>
      {/each}
    </div>
  </header>

  <div class="min-h-0 flex-1 space-y-6 overflow-auto p-3">
    {#if step === 0}
      <SettingsSectionConnection bind:form />
      {#if auth.value.authenticated}
        <!-- Language + namespace appear once connected, like the original. -->
        <SettingsSectionProject bind:form hideDisabledNotes />
      {/if}
    {:else if step === 1}
      <SettingsSectionKeys bind:form />
      <SettingsSectionSync bind:form />
    {:else}
      <SettingsSectionPush bind:form />
    {/if}
  </div>

  <footer class="flex shrink-0 items-center justify-between border-t border-border p-3">
    {#if step > 0}
      <Button variant="ghost" size="sm" onclick={back}>
        <ArrowLeft size={ICON.inline} /> Back
      </Button>
    {:else}
      <span></span>
    {/if}
    <Button size="sm" disabled={!canAdvance} onclick={next}>
      {#if step === TITLES.length - 1}
        Save
      {:else}
        Next <ArrowRight size={ICON.inline} />
      {/if}
    </Button>
  </footer>
</div>
