<script lang="ts">
  import type { TolgeeConfig } from "$shared/types";
  import { appState } from "$ui/lib/stores/app.svelte";
  import { send } from "$ui/lib/bus";
  import * as Tabs from "$ui/lib/components/ui/tabs";
  import ViewHeader from "$ui/lib/components/domain/ViewHeader.svelte";
  import ViewFooter from "$ui/lib/components/domain/ViewFooter.svelte";
  import SettingsSectionConnection from "$ui/lib/components/domain/SettingsSectionConnection.svelte";
  import SettingsSectionProject from "$ui/lib/components/domain/SettingsSectionProject.svelte";
  import SettingsSectionKeys from "$ui/lib/components/domain/SettingsSectionKeys.svelte";
  import SettingsSectionSync from "$ui/lib/components/domain/SettingsSectionSync.svelte";
  import SettingsSectionPush from "$ui/lib/components/domain/SettingsSectionPush.svelte";
  import SettingsSectionAnnotations from "$ui/lib/components/domain/SettingsSectionAnnotations.svelte";

  const DEFAULT_API_URL = "https://app.tolgee.io";

  // Initial snapshot from the global app config. Subsequent external updates
  // are intentionally ignored so the user does not lose in-progress edits.
  //
  // Fields bound with bind:value to Input/Select must never be undefined:
  // Svelte 5 throws props_invalid_value when bind: passes undefined to a
  // $bindable prop that has a non-undefined default (e.g. $bindable("")).
  const cfg = appState.value.config ?? {};
  let form = $state<Partial<TolgeeConfig>>({
    ...cfg,
    apiUrl: cfg.apiUrl ?? DEFAULT_API_URL,
    apiKey: cfg.apiKey ?? "",
    namespace: cfg.namespace ?? "",
    language: cfg.language ?? "",
    ignorePrefix: cfg.ignorePrefix ?? "_",
  });

  const route = appState.value.route;
  let activeTab = $state(route.name === "settings" ? (route.tab ?? "project") : "project");

  function save(): void {
    send({ type: "save-config", config: form });
    appState.setConfig({ ...(appState.value.config ?? {}), ...form });
    appState.navigate({ name: "index" });
  }

  function cancel(): void {
    appState.navigate({ name: "index" });
  }
</script>

<div class="flex h-full flex-col">
  <ViewHeader title="Settings" onBack={cancel} />

  <Tabs.Root bind:value={activeTab} class="flex min-h-0 flex-1 flex-col">
    <Tabs.List class="grid shrink-0 grid-cols-4 border-b border-border px-1">
      <Tabs.Trigger value="project">Project</Tabs.Trigger>
      <Tabs.Trigger value="strings">Strings and Keys</Tabs.Trigger>
      <Tabs.Trigger value="upload">Upload to Tolgee</Tabs.Trigger>
      <Tabs.Trigger value="annotations">Annotations</Tabs.Trigger>
    </Tabs.List>

    <div class="min-h-0 flex-1 overflow-auto p-3">
      <Tabs.Content value="project">
        <div class="space-y-6">
          <SettingsSectionConnection bind:form />
          <SettingsSectionProject bind:form />
        </div>
      </Tabs.Content>
      <Tabs.Content value="strings">
        <div class="space-y-6">
          <SettingsSectionKeys bind:form />
          <SettingsSectionSync bind:form />
        </div>
      </Tabs.Content>
      <Tabs.Content value="upload">
        <SettingsSectionPush bind:form />
      </Tabs.Content>
      <Tabs.Content value="annotations">
        <SettingsSectionAnnotations />
      </Tabs.Content>
    </div>
  </Tabs.Root>

  <ViewFooter onCancel={cancel} confirmLabel="Save" onConfirm={save} />
</div>
