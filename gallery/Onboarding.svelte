<script lang="ts">
  import type { TolgeeConfig } from "$shared/types";
  import { Button } from "$ui/lib/components/ui";
  import Tolgee from "$ui/lib/components/icons/Tolgee.svelte";
  import { ICON } from "$shared/iconSizes";
  import Settings from "lucide-svelte/icons/settings";
  import ArrowRight from "lucide-svelte/icons/arrow-right";
  import ArrowLeft from "lucide-svelte/icons/arrow-left";
  import Check from "lucide-svelte/icons/check";

  // The REAL settings sections — the whole point: the wizard reuses them, it
  // does not re-implement them. Change a section once and it updates in both
  // Settings and here.
  import SettingsSectionConnection from "$ui/lib/components/domain/SettingsSectionConnection.svelte";
  import SettingsSectionProject from "$ui/lib/components/domain/SettingsSectionProject.svelte";
  import SettingsSectionKeys from "$ui/lib/components/domain/SettingsSectionKeys.svelte";
  import SettingsSectionSync from "$ui/lib/components/domain/SettingsSectionSync.svelte";
  import SettingsSectionPush from "$ui/lib/components/domain/SettingsSectionPush.svelte";
  import { seedMockData } from "./mock";

  // Seeds the shared auth/app stores (authenticated, project "Figma 2.0",
  // languages…) so the real sections render exactly as they do in the plugin.
  seedMockData();

  // Each step just declares WHICH sections it shows — zero duplicated markup.
  const STEPS: {
    title: string;
    sections: ("connection" | "project" | "keys" | "sync" | "push")[];
  }[] = [
    { title: "Connect", sections: ["connection", "project"] },
    { title: "Strings and keys", sections: ["keys", "sync"] },
    { title: "Upload to Tolgee", sections: ["push"] },
  ];

  let step = $state(0);
  let done = $state(false);

  // One shared form, threaded through every section — same object Settings binds.
  let form = $state<Partial<TolgeeConfig>>({
    apiUrl: "https://app.tolgee.io",
    apiKey: "tgpak_demo",
    language: "en",
    namespace: "",
    ignoreNumbers: true,
    ignoreHiddenLayers: true,
    ignoreTextLayers: false,
    ignorePrefix: "_",
    prefillKeyFormat: false,
    updateScreenshots: true,
    addTags: false,
  });

  function next(): void {
    if (step < STEPS.length - 1) step += 1;
    else done = true;
  }
  function back(): void {
    if (step > 0) step -= 1;
  }
  function restart(): void {
    step = 0;
    done = false;
  }
</script>

<div class="space-y-6">
  <p class="text-xs text-text-secondary">
    First-run setup. <strong class="text-text">Left</strong> is what ships
    today; <strong class="text-text">right</strong> is a proposed guided
    version that <strong class="text-text">reuses the real Settings sections</strong>
    — no duplicated markup, and any settings change shows up here automatically.
    A design preview: the real plugin is unchanged.
  </p>

  <div class="grid gap-6 md:grid-cols-2">
    <!-- ================= LEFT: TODAY ================= -->
    <section class="space-y-3">
      <div class="flex items-baseline gap-2">
        <h2 class="text-sm font-semibold text-primary">Today</h2>
        <span class="text-[11px] text-text-secondary">2 screens + a hunt</span>
      </div>

      <!-- The extra "sign in" screen the wizard removes. -->
      <div class="overflow-hidden rounded-lg border border-border bg-bg shadow-sm">
        <header
          class="flex items-center justify-between border-b border-border bg-linear-to-b from-bg to-header-gradient-end px-3 py-2"
        >
          <span class="text-sm font-semibold">Strings</span>
          <Settings size={ICON.action} class="text-text-secondary" />
        </header>
        <div class="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <p class="text-sm">Sign in to connect this document with Tolgee.</p>
          <Button>Open Settings</Button>
        </div>
      </div>

      <ol class="list-decimal space-y-1 pl-5 text-[11px] leading-snug text-text-secondary">
        <li>This "Sign in" screen — one extra screen and click before anything.</li>
        <li>Then the full Settings page: three tabs (Project / Strings and Keys / Upload), all shown at once.</li>
        <li>The user works out the order themselves — no progress, no clear "done".</li>
      </ol>
    </section>

    <!-- ================= RIGHT: PROPOSED WIZARD ================= -->
    <section class="space-y-3">
      <div class="flex items-baseline gap-2">
        <h2 class="text-sm font-semibold text-primary">Proposed: guided setup</h2>
        <span class="text-[11px] text-text-secondary">real sections, click through</span>
      </div>

      <div class="overflow-hidden rounded-lg border border-border bg-bg shadow-sm">
        {#if done}
          <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success"
            >
              <Check size={28} />
            </div>
            <p class="text-sm font-semibold">You're all set</p>
            <Button variant="outline" size="sm" onclick={restart}>
              Replay the setup
            </Button>
          </div>
        {:else}
          <!-- Header: brand + step indicator + progress bar -->
          <header
            class="border-b border-border bg-linear-to-b from-bg to-header-gradient-end px-3 py-2.5"
          >
            <div class="flex items-center gap-2">
              <Tolgee size={ICON.action} class="text-primary" />
              <span class="text-sm font-semibold">Set up Tolgee</span>
              <span class="ml-auto text-[11px] text-text-secondary">
                {STEPS[step].title} · {step + 1}/{STEPS.length}
              </span>
            </div>
            <div class="mt-2 flex gap-1">
              {#each STEPS as _, i (i)}
                <div
                  class="h-1 flex-1 rounded-full transition-colors"
                  class:bg-bg-brand={i <= step}
                  class:bg-border={i > step}
                ></div>
              {/each}
            </div>
          </header>

          <!-- Body: the REAL sections for this step, nothing re-implemented. -->
          <div class="min-h-[210px] space-y-6 p-3">
            {#each STEPS[step].sections as name (name)}
              {#if name === "connection"}
                <SettingsSectionConnection bind:form />
              {:else if name === "project"}
                <SettingsSectionProject bind:form />
              {:else if name === "keys"}
                <SettingsSectionKeys bind:form />
              {:else if name === "sync"}
                <SettingsSectionSync bind:form />
              {:else if name === "push"}
                <SettingsSectionPush bind:form />
              {/if}
            {/each}
          </div>

          <!-- Footer: Back / Next -->
          <footer class="flex items-center justify-between border-t border-border p-3">
            {#if step > 0}
              <Button variant="ghost" size="sm" onclick={back}>
                <ArrowLeft size={ICON.inline} /> Back
              </Button>
            {:else}
              <span></span>
            {/if}
            <Button size="sm" onclick={next}>
              {#if step === STEPS.length - 1}
                Save
              {:else}
                Next <ArrowRight size={ICON.inline} />
              {/if}
            </Button>
          </footer>
        {/if}
      </div>

      <p class="text-[11px] italic leading-snug text-text-secondary">
        Straight into setup on first run (no "Sign in" screen), the same three
        Settings sections one step at a time, Back / Next, ending on the plugin
        ready to use. The steps only pick WHICH sections to show — the sections
        themselves are the real components.
      </p>
    </section>
  </div>
</div>
