/**
 * Pure percentage/indeterminate logic for `progressBar.svelte`, pulled out so
 * it can be unit-tested without any Svelte component-render infrastructure
 * (this repo deliberately has none — see tasks 3/7/11/13).
 *
 * `total === null` (or `<= 0`) means the size isn't known yet — the caller
 * should render the indeterminate sliding animation instead of a fill.
 * Otherwise the percentage is rounded and clamped to `[0, 100]` so a stale
 * `loaded > total` (or a negative `loaded`) never overflows/underflows the
 * bar.
 */
export function computeProgressPercent(
  loaded: number,
  total: number | null,
): number | null {
  if (total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
}
