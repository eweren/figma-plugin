import { afterEach, describe, expect, it, vi } from "vitest";
import { TOLGEE_PLUGIN_CONFIG_NAME } from "$shared/constants";
import { removeExistingCopyPages } from "../createCopy";

type FakePage = {
  type: "PAGE";
  name: string;
  loadAsync: () => Promise<void>;
  getPluginData: (key: string) => string;
  remove: () => void;
};

function page(name: string, pageData?: Record<string, unknown>): FakePage {
  const raw = pageData ? JSON.stringify(pageData) : "";
  return {
    type: "PAGE",
    name,
    loadAsync: vi.fn(async () => {}),
    getPluginData: (key: string) => (key === TOLGEE_PLUGIN_CONFIG_NAME ? raw : ""),
    remove: vi.fn(),
  };
}

function setPages(pages: FakePage[]) {
  (globalThis as unknown as { figma: unknown }).figma = { root: { children: pages } };
}

afterEach(() => {
  (globalThis as unknown as { figma?: unknown }).figma = undefined;
});

describe("removeExistingCopyPages", () => {
  it("removes a previous copy with the same name", async () => {
    const oldCopy = page("Home — en", { pageCopy: true });
    setPages([page("Home"), oldCopy]);

    await removeExistingCopyPages("Home — en");

    expect(oldCopy.remove).toHaveBeenCalledTimes(1);
  });

  it("does NOT remove a user's own same-named page (not marked pageCopy)", async () => {
    const userPage = page("Home — en"); // no pageCopy marker
    setPages([userPage]);

    await removeExistingCopyPages("Home — en");

    expect(userPage.remove).not.toHaveBeenCalled();
  });

  it("does NOT remove a copy with a different name", async () => {
    const otherCopy = page("Home — de", { pageCopy: true });
    setPages([otherCopy]);

    await removeExistingCopyPages("Home — en");

    expect(otherCopy.remove).not.toHaveBeenCalled();
    // Non-matching pages aren't even loaded.
    expect(otherCopy.loadAsync).not.toHaveBeenCalled();
  });
});
