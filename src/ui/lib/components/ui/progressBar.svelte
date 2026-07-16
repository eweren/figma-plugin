<script lang="ts">
  import { cn } from "$ui/lib/utils";

  /**
   * Thin, DETERMINATE progress bar for in-flight operations whose `total` is
   * known (or becomes known) up front — bulk writes over a selection
   * (`nodes-set-progress`) and batched key lookups for the Push diff
   * (`fetchRemoteKeys`'s `onProgress`). Unlike `PullProgress` (which falls
   * back to an indeterminate sliding animation when `total` is `null` —
   * page scans don't know their size ahead of time), this primitive always
   * renders a real percentage; a `null`/zero `total` just reads as an empty
   * bar until the caller has a number to show.
   */
  type Props = {
    loaded: number;
    total: number | null;
    /** Optional label row above the bar (e.g. "Computing changes…"). Omit
        for a bare bar with no text — used at the top of Index, where the
        bulk action bar below already communicates what's happening. */
    label?: string;
    class?: string;
  };

  let { loaded, total, label, class: className }: Props = $props();

  const pct = $derived(
    total !== null && total > 0
      ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100)))
      : 0,
  );
</script>

<div class={cn("flex flex-col gap-1", className)}>
  {#if label}
    <div
      class="flex items-center justify-between text-[10px] text-text-secondary"
    >
      <span>{label}</span>
      <span>{loaded} / {total ?? "…"}</span>
    </div>
  {/if}
  <div
    class="h-0.5 w-full overflow-hidden rounded-full bg-bg-secondary"
    role="progressbar"
    aria-valuenow={loaded}
    aria-valuemin={0}
    aria-valuemax={total ?? undefined}
  >
    <div
      class="h-full bg-bg-brand transition-[width] duration-200 ease-out"
      style="width: {pct}%"
    ></div>
  </div>
</div>
