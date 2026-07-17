import { afterEach, describe, expect, it, vi } from "vitest";
import { TOLGEE_PLUGIN_CONFIG_NAME } from "$shared/constants";
import type { NodeInfo } from "$shared/types";
import { removeExistingCopyPages, resolveCopyNodeText } from "../createCopy";

function makeNodeInfo(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id: "n",
    name: "Layer",
    characters: "",
    translation: "",
    isPlural: false,
    key: "k",
    ns: undefined,
    connected: true,
    ...overrides,
  };
}

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

describe("resolveCopyNodeText", () => {
  const PLURAL = "{count, plural, one {# apple} other {# apples}}";

  it("renders a plural remote translation using the NODE's own sample count, not the raw ICU", () => {
    const info = makeNodeInfo({ isPlural: true, pluralParamValue: "9" });
    const result = resolveCopyNodeText(info, { text: PLURAL, isPlural: true }, "en");
    expect(result).toBe("9 apples");
  });

  it("renders a parametrized remote translation using the node's own paramsValues", () => {
    const info = makeNodeInfo({ paramsValues: { name: "Zuzana" } });
    const result = resolveCopyNodeText(info, { text: "Hello {name}!", isPlural: false }, "en");
    expect(result).toBe("Hello Zuzana!");
  });

  it("trusts the remote isPlural flag over the node's own (possibly stale) one", () => {
    // Node's local `isPlural` says false, but the key really is a plural on
    // the server — the remote flag must win so the plural sample is seeded.
    const info = makeNodeInfo({ isPlural: false, pluralParamValue: "3" });
    const result = resolveCopyNodeText(info, { text: PLURAL, isPlural: true }, "en");
    expect(result).toBe("3 apples");
  });

  it("falls back to the node's persisted translation when there's no remote match", () => {
    const info = makeNodeInfo({ isPlural: true, pluralParamValue: "2", translation: PLURAL });
    const result = resolveCopyNodeText(info, undefined, "en");
    expect(result).toBe("2 apples");
  });

  it("returns null when there's neither a remote match nor a persisted translation", () => {
    const info = makeNodeInfo({ translation: "" });
    expect(resolveCopyNodeText(info, undefined, "en")).toBeNull();
  });

  it("keeps inline HTML tags in the rendered output for applyRichText to consume", () => {
    const info = makeNodeInfo();
    const result = resolveCopyNodeText(info, { text: "<b>Bold text</b>", isPlural: false }, "en");
    expect(result).toBe("<b>Bold text</b>");
  });
});
