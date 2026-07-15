/**
 * Timeout watchdog for UI -> main round-trips over `bus.ts`.
 *
 * Every UI -> main request (`send()` + a correlated `on()` listener waiting
 * for the matching result) currently waits forever. Main-thread error
 * handling is already hardened elsewhere (the bus dispatch has try/catch,
 * `applyTranslations`/`setNodesData` collect per-node errors instead of
 * throwing) — this isn't a reproducing crash, it's a missing safety net: if a
 * response is ever lost for a reason NOT covered by that handling (an
 * exception escaping a try/catch somewhere, Figma killing the sandboxed
 * process, a future regression), the UI hangs on a spinner forever with no
 * recovery except force-quitting the plugin.
 *
 * This module is intentionally just the "give up after N seconds of
 * silence" timer. Call sites keep wiring their own `on()` listeners for the
 * message types they care about — the shapes differ too much (single result
 * vs. streamed progress + terminal message) to force through one generic
 * `request()` function. A shared timeout MECHANISM matters more than a
 * shared request SHAPE.
 */

export interface RequestWatchdog {
  /**
   * (Re)start the idle timer. Call once when the request is sent, and again
   * on every intermediate/progress message for streamed round-trips so a
   * slow-but-progressing operation isn't killed while it's still active.
   */
  touch(): void;
  /**
   * Stop the timer for good. Call as soon as the round-trip settles
   * (terminal message received, or the caller otherwise gives up) so the
   * timeout can never fire after the fact.
   */
  clear(): void;
}

/**
 * Starts an idle timeout that invokes `onTimeout` if `touch()` isn't called
 * again within `timeoutMs`. The timer starts armed immediately (equivalent to
 * an implicit `touch()` at request time) — callers don't need to call
 * `touch()` before the first wait.
 *
 * `onTimeout` fires at most once; after it fires (or after `clear()`) further
 * `touch()` calls are ignored to avoid resurrecting a settled/timed-out
 * request.
 */
export function createIdleTimeout(
  timeoutMs: number,
  onTimeout: () => void,
): RequestWatchdog {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const arm = (): void => {
    if (settled) return;
    if (handle !== undefined) clearTimeout(handle);
    handle = setTimeout(() => {
      settled = true;
      handle = undefined;
      onTimeout();
    }, timeoutMs);
  };

  const clear = (): void => {
    settled = true;
    if (handle !== undefined) {
      clearTimeout(handle);
      handle = undefined;
    }
  };

  arm();
  return { touch: arm, clear };
}
