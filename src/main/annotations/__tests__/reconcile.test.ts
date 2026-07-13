import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the modules `reconcile` pulls in so we can assert whether a pass runs
// without touching the real Figma annotation API.
const { applyAnnotations, ensureTolgeeCategory } = vi.hoisted(() => ({
  applyAnnotations: vi.fn(async () => {}),
  ensureTolgeeCategory: vi.fn(async () => "cat-1"),
}));
vi.mock("../sync", () => ({ applyAnnotations }));
vi.mock("../category", () => ({ ensureTolgeeCategory }));

import { cancelReconcile, scheduleReconcile } from "../reconcile";

beforeEach(() => {
  vi.useFakeTimers();
  applyAnnotations.mockClear();
  ensureTolgeeCategory.mockClear();
  (globalThis as unknown as { figma: unknown }).figma = {
    editorType: "figma",
    getNodeByIdAsync: vi.fn(async (id: string) => ({ id, type: "TEXT" })),
  };
});

afterEach(() => {
  cancelReconcile(); // reset module state between tests
  vi.useRealTimers();
});

describe("reconcile scheduling", () => {
  it("applies annotations after the debounce window", async () => {
    scheduleReconcile(["a"], true);
    await vi.runAllTimersAsync();
    expect(applyAnnotations).toHaveBeenCalledTimes(1);
  });

  it("cancelReconcile stops a pending pass from re-adding annotations", async () => {
    scheduleReconcile(["a"], true);
    cancelReconcile(); // e.g. the user just turned annotations OFF
    await vi.runAllTimersAsync();
    expect(applyAnnotations).not.toHaveBeenCalled();
  });

  it("does nothing when scheduled while disabled", async () => {
    scheduleReconcile(["a"], false);
    await vi.runAllTimersAsync();
    expect(applyAnnotations).not.toHaveBeenCalled();
  });
});
