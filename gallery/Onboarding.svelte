<script lang="ts">
  import {
    Button,
    Input,
    Label,
    Message,
    KeyFormatInput,
    CheckboxField,
    Tabs,
  } from "$ui/lib/components/ui";
  import Tolgee from "$ui/lib/components/icons/Tolgee.svelte";
  import { ICON } from "$shared/iconSizes";
  import Settings from "lucide-svelte/icons/settings";
  import ArrowRight from "lucide-svelte/icons/arrow-right";
  import ArrowLeft from "lucide-svelte/icons/arrow-left";
  import Check from "lucide-svelte/icons/check";

  // ---- Proposed wizard: local click-through state (design preview only) -----
  // Nothing here touches the real plugin — it's a mock so the flow can be
  // walked step by step in the gallery, the way the real one would feel.
  const STEPS = ["Connect", "Key format", "Upload"] as const;
  let step = $state(0);
  let connected = $state(false);
  let done = $state(false);
  let keyFormat = $state("{artboard}.{elementName}");
  let uploadScreenshots = $state(true);

  function next(): void {
    if (step < STEPS.length - 1) step += 1;
    else done = true;
  }
  function back(): void {
    if (step > 0) step -= 1;
  }
  function restart(): void {
    step = 0;
    connected = false;
    done = false;
  }
</script>

<div class="space-y-6">
  <div class="space-y-2">
    <p class="text-xs text-text-secondary">
      First-run setup, side by side. <strong class="text-text">Left</strong> is
      what ships today; <strong class="text-text">right</strong> is a proposed
      guided version — one step at a time, Back / Next, like the original
      plugin. This is a design preview: the real plugin is unchanged.
    </p>
  </div>

  <div class="grid gap-6 md:grid-cols-2">
    <!-- ================= LEFT: CURRENT FLOW ================= -->
    <section class="space-y-3">
      <div class="flex items-baseline gap-2">
        <h2 class="text-sm font-semibold text-primary">Current flow</h2>
        <span class="text-[11px] text-text-secondary">as shipped</span>
      </div>

      <!-- 1 · Sign-in empty state (Index, unauthenticated) -->
      <div class="space-y-1">
        <p class="text-[11px] font-medium text-text-secondary">
          1 · Index — not connected
        </p>
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
      </div>

      <!-- 2 · Settings (tabbed, all at once) -->
      <div class="space-y-1">
        <p class="text-[11px] font-medium text-text-secondary">
          2 · Settings — three tabs, shown all at once
        </p>
        <div class="overflow-hidden rounded-lg border border-border bg-bg shadow-sm">
          <div class="bg-linear-to-b from-bg to-header-gradient-end">
            <div class="flex h-9 items-center px-3">
              <span class="text-sm font-semibold">Settings</span>
            </div>
            <Tabs.Root value="project" class="contents">
              <Tabs.List class="border-b border-border px-1">
                <Tabs.Trigger value="project">Project</Tabs.Trigger>
                <Tabs.Trigger value="strings">Strings and Keys</Tabs.Trigger>
                <Tabs.Trigger value="upload">Upload to Tolgee</Tabs.Trigger>
              </Tabs.List>
            </Tabs.Root>
          </div>
          <div class="space-y-2.5 p-3">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-primary">
              Connection
            </h3>
            <div class="space-y-1">
              <Label for="onb-cur-url">Tolgee URL</Label>
              <Input id="onb-cur-url" value="https://app.tolgee.io" class="w-full" />
            </div>
            <div class="space-y-1">
              <Label for="onb-cur-key">Tolgee Project API key</Label>
              <Input id="onb-cur-key" type="password" value="tgpak_xxxxxxxx" class="w-full" />
            </div>
            <Button>Connect</Button>
          </div>
        </div>
      </div>

      <!-- 3 · Connected -->
      <div class="space-y-1">
        <p class="text-[11px] font-medium text-text-secondary">
          3 · Connected
        </p>
        <div class="overflow-hidden rounded-lg border border-border bg-bg shadow-sm">
          <div class="p-3">
            <Message variant="secondary">
              <span class="flex items-center gap-1">
                <strong class="font-semibold underline underline-offset-2">My Project</strong>
                was successfully connected
              </span>
            </Message>
          </div>
        </div>
      </div>

      <p class="text-[11px] italic leading-snug text-text-secondary">
        The user lands on a full settings page with three tabs and has to work
        out the order themselves — no sense of progress or a clear "done".
      </p>
    </section>

    <!-- ================= RIGHT: PROPOSED WIZARD ================= -->
    <section class="space-y-3">
      <div class="flex items-baseline gap-2">
        <h2 class="text-sm font-semibold text-primary">Proposed: guided setup</h2>
        <span class="text-[11px] text-text-secondary">click through it</span>
      </div>

      <div class="overflow-hidden rounded-lg border border-border bg-bg shadow-sm">
        {#if done}
          <!-- Done state -->
          <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success"
            >
              <Check size={28} />
            </div>
            <p class="text-sm font-semibold">You're all set</p>
            <p class="text-xs text-text-secondary">
              The plugin is connected and ready. Select a text layer to start.
            </p>
            <Button variant="outline" size="sm" onclick={restart}>
              Replay the setup
            </Button>
          </div>
        {:else}
          <!-- Header: brand + step indicator -->
          <header
            class="border-b border-border bg-linear-to-b from-bg to-header-gradient-end px-3 py-2.5"
          >
            <div class="flex items-center gap-2">
              <Tolgee size={ICON.action} class="text-primary" />
              <span class="text-sm font-semibold">Set up Tolgee</span>
              <span class="ml-auto text-[11px] text-text-secondary">
                Step {step + 1} of {STEPS.length}
              </span>
            </div>
            <!-- Progress dots -->
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

          <!-- Step body -->
          <div class="min-h-[190px] space-y-3 p-3">
            {#if step === 0}
              <div class="space-y-1">
                <h3 class="text-sm font-semibold">Connect your project</h3>
                <p class="text-[11px] text-text-secondary">
                  Paste your Tolgee project API key. Nothing is uploaded yet.
                </p>
              </div>
              <div class="space-y-1">
                <Label for="onb-wiz-url">Tolgee URL</Label>
                <Input id="onb-wiz-url" value="https://app.tolgee.io" class="w-full" />
              </div>
              <div class="space-y-1">
                <Label for="onb-wiz-key">Tolgee Project API key</Label>
                <Input
                  id="onb-wiz-key"
                  type="password"
                  value="tgpak_xxxxxxxx"
                  class="w-full"
                />
              </div>
              {#if connected}
                <Message variant="secondary">
                  <span class="flex items-center gap-1">
                    <strong class="font-semibold">My Project</strong>
                    was successfully connected
                  </span>
                </Message>
              {:else}
                <Button onclick={() => (connected = true)}>Connect</Button>
              {/if}
            {:else if step === 1}
              <div class="space-y-1">
                <h3 class="text-sm font-semibold">How should keys be named?</h3>
                <p class="text-[11px] text-text-secondary">
                  New keys use this pattern. You can change it later in Settings.
                </p>
              </div>
              <div class="space-y-1">
                <Label>Key format</Label>
                <KeyFormatInput value={keyFormat} onChange={(v) => (keyFormat = v)} />
              </div>
            {:else}
              <div class="space-y-1">
                <h3 class="text-sm font-semibold">Upload options</h3>
                <p class="text-[11px] text-text-secondary">
                  A couple of defaults for when you push strings to Tolgee.
                </p>
              </div>
              <CheckboxField
                label="Upload screenshots"
                checked={uploadScreenshots}
                onChange={(v) => (uploadScreenshots = v)}
              />
              <p class="pl-6 text-[11px] text-text-secondary">
                Sends a screenshot of each frame so translators see context.
              </p>
            {/if}
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
            <Button
              size="sm"
              disabled={step === 0 && !connected}
              onclick={next}
            >
              {#if step === STEPS.length - 1}
                Finish
              {:else}
                Next <ArrowRight size={ICON.inline} />
              {/if}
            </Button>
          </footer>
        {/if}
      </div>

      <p class="text-[11px] italic leading-snug text-text-secondary">
        One thing per screen, a visible progress bar, Back / Next, and a clear
        "You're all set" at the end — the same simple shape as the original
        plugin's three-step setup.
      </p>
    </section>
  </div>
</div>
