import { beforeEach, describe, expect, it } from "vitest";
import { appState } from "$ui/lib/stores/app.svelte";

/**
 * `appState` is a module-level singleton (mirrors how the real app imports
 * it), so each test resets the one bit of state it exercises instead of
 * re-creating the store.
 */
beforeEach(() => {
  appState.clearWriteProgress();
});

describe("appState write progress (nodes-set-progress / nodes-set-result glue)", () => {
  it("starts out clear", () => {
    expect(appState.value.writeProgress).toBeNull();
  });

  it("setWriteProgress reflects an in-flight nodes-set-progress message", () => {
    appState.setWriteProgress(50, 250);
    expect(appState.value.writeProgress).toEqual({ done: 50, total: 250 });

    // Later progress messages for the same write just replace the value.
    appState.setWriteProgress(100, 250);
    expect(appState.value.writeProgress).toEqual({ done: 100, total: 250 });
  });

  it("clearWriteProgress resets to null once the matching nodes-set-result arrives", () => {
    appState.setWriteProgress(250, 250);
    expect(appState.value.writeProgress).not.toBeNull();

    appState.clearWriteProgress();
    expect(appState.value.writeProgress).toBeNull();
  });

  it("clearing when already null is a no-op (a small write with no progress messages still clears fine)", () => {
    expect(appState.value.writeProgress).toBeNull();
    appState.clearWriteProgress();
    expect(appState.value.writeProgress).toBeNull();
  });
});
