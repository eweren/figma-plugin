<script lang="ts">
  import type { Snippet } from "svelte";
  import { setContext } from "svelte";
  import Button from "$ui/lib/components/ui/button.svelte";
  import { BUTTON_SIZE_CTX } from "$ui/lib/components/ui/buttonContext";

  // Pin every action button in the bar (prop-API *and* the ones passed via the
  // children escape hatch) to one size, so footers never drift. Change here →
  // changes everywhere.
  setContext(BUTTON_SIZE_CTX, "lg");

  /**
   * Shared bottom action bar for sub-views (Settings, Connect, Push, …).
   *
   * Locks in one container + button convention so the footer never drifts
   * between screens: a ghost "Cancel" on the left, the primary confirm action
   * on the right, same border / padding / alignment everywhere.
   *
   * Simple screens use the prop API (`onCancel` + `onConfirm`) and get an
   * identical bar for free. Screens with multi-state actions (Pull, Push) pass
   * a `children` snippet to supply their own stateful buttons while keeping the
   * exact same container.
   */
  type Props = {
    confirmLabel?: string;
    onConfirm?: () => void;
    confirmDisabled?: boolean;
    cancelLabel?: string;
    onCancel?: () => void;
    children?: Snippet;
  };
  let {
    confirmLabel,
    onConfirm,
    confirmDisabled = false,
    cancelLabel = "Cancel",
    onCancel,
    children,
  }: Props = $props();
</script>

<footer class="flex items-center justify-end gap-2 border-t border-border p-2">
  {#if children}
    {@render children()}
  {:else}
    {#if onCancel}
      <Button variant="ghost" onclick={onCancel}>{cancelLabel}</Button>
    {/if}
    {#if onConfirm}
      <Button onclick={onConfirm} disabled={confirmDisabled}>
        {confirmLabel}
      </Button>
    {/if}
  {/if}
</footer>
