import { afterEach, describe, expect, it, vi } from "vitest";
import { TOLGEE_NODE_INFO, TOLGEE_PLUGIN_CONFIG_NAME } from "$shared/constants";
import type { NodeInfo } from "$shared/types";
import { checkCopyStaleness, removeExistingCopyPages, resolveCopyNodeText } from "../createCopy";

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

type FakeTextNode = {
  type: "TEXT";
  id: string;
  name: string;
  characters: string;
  visible: boolean;
  getPluginData: (key: string) => string;
};

let nextNodeId = 0;

function textNode(info: { key?: string; ns?: string; connected?: boolean } = {}): FakeTextNode {
  nextNodeId++;
  const data = JSON.stringify({
    key: info.key ?? "",
    ns: info.ns,
    connected: info.connected ?? true,
  });
  return {
    type: "TEXT",
    id: `node-${nextNodeId}`,
    name: "Layer",
    characters: "",
    visible: true,
    getPluginData: (k: string) => (k === TOLGEE_NODE_INFO ? data : ""),
  };
}

type FakePage = {
  type: "PAGE";
  id: string;
  name: string;
  loadAsync: () => Promise<void>;
  getPluginData: (key: string) => string;
  setPluginData: (key: string, value: string) => void;
  remove: () => void;
  findAllWithCriteria: () => FakeTextNode[];
};

function page(
  name: string,
  pageData?: Record<string, unknown>,
  opts: { id?: string; textNodes?: FakeTextNode[] } = {},
): FakePage {
  let raw = pageData ? JSON.stringify(pageData) : "";
  const textNodes = opts.textNodes ?? [];
  return {
    type: "PAGE",
    id: opts.id ?? name,
    name,
    loadAsync: vi.fn(async () => {}),
    getPluginData: (key: string) => (key === TOLGEE_PLUGIN_CONFIG_NAME ? raw : ""),
    setPluginData: (key: string, value: string) => {
      if (key === TOLGEE_PLUGIN_CONFIG_NAME) raw = value;
    },
    remove: vi.fn(),
    findAllWithCriteria: () => textNodes,
  };
}

function setPages(pages: FakePage[], currentPage?: FakePage) {
  (globalThis as unknown as { figma: unknown }).figma = {
    root: { children: pages },
    currentPage: currentPage ?? pages[0],
    getNodeByIdAsync: async (id: string) => pages.find((p) => p.id === id) ?? null,
    mixed: Symbol("mixed"),
  };
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

  describe("when the page being removed is the currently active one", () => {
    it("steps onto the preferred fallback first, then removes it (and reports it)", async () => {
      const source = page("Home", undefined, { id: "src" });
      const activeCopy = page("Home — en", { pageCopy: true }, { id: "copy" });
      setPages([source, activeCopy], activeCopy);

      const result = await removeExistingCopyPages("Home — en", source as never);

      expect(result.switchedAwayFromCurrent).toBe(true);
      expect(
        (globalThis as unknown as { figma: { currentPage: FakePage } }).figma.currentPage,
      ).toBe(source);
      expect(activeCopy.remove).toHaveBeenCalledTimes(1);
    });

    it("doesn't touch the current page when the copy being removed isn't it", async () => {
      const source = page("Home", undefined, { id: "src" });
      const oldCopy = page("Home — en", { pageCopy: true }, { id: "copy" });
      setPages([source, oldCopy], source);

      const result = await removeExistingCopyPages("Home — en", source as never);

      expect(result.switchedAwayFromCurrent).toBe(false);
      expect(
        (globalThis as unknown as { figma: { currentPage: FakePage } }).figma.currentPage,
      ).toBe(source);
      expect(oldCopy.remove).toHaveBeenCalledTimes(1);
    });
  });
});

describe("checkCopyStaleness", () => {
  it("reports 0 missing when the copy already has every key the source has", async () => {
    const source = page("Home", undefined, {
      id: "src",
      textNodes: [textNode({ key: "a" }), textNode({ key: "b" })],
    });
    const copyPage = page(
      "Home — en",
      { pageCopy: true, sourcePageId: "src", language: "en" },
      { id: "copy", textNodes: [textNode({ key: "a" }), textNode({ key: "b" })] },
    );
    setPages([source, copyPage], copyPage);

    await expect(checkCopyStaleness(copyPage as never)).resolves.toEqual({
      ok: true,
      missingCount: 0,
    });
  });

  it("counts source keys the copy doesn't have yet", async () => {
    const source = page("Home", undefined, {
      id: "src",
      textNodes: [textNode({ key: "a" }), textNode({ key: "b" }), textNode({ key: "c" })],
    });
    const copyPage = page(
      "Home — en",
      { pageCopy: true, sourcePageId: "src", language: "en" },
      { id: "copy", textNodes: [textNode({ key: "a" })] },
    );
    setPages([source, copyPage], copyPage);

    await expect(checkCopyStaleness(copyPage as never)).resolves.toEqual({
      ok: true,
      missingCount: 2,
    });
  });

  it("ignores nodes that aren't actually connected on either side", async () => {
    const source = page("Home", undefined, {
      id: "src",
      textNodes: [textNode({ key: "a" }), textNode({ key: "unconnected", connected: false })],
    });
    const copyPage = page(
      "Home — en",
      { pageCopy: true, sourcePageId: "src", language: "en" },
      { id: "copy", textNodes: [textNode({ key: "a" })] },
    );
    setPages([source, copyPage], copyPage);

    await expect(checkCopyStaleness(copyPage as never)).resolves.toEqual({
      ok: true,
      missingCount: 0,
    });
  });

  it("fails gracefully when the copy has no sourcePageId recorded (older copy / production)", async () => {
    const copyPage = page("Home — en", { pageCopy: true }, { id: "copy" });
    setPages([copyPage], copyPage);

    const result = await checkCopyStaleness(copyPage as never);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("fails gracefully when the recorded source page no longer exists", async () => {
    const copyPage = page(
      "Home — en",
      { pageCopy: true, sourcePageId: "gone" },
      { id: "copy" },
    );
    setPages([copyPage], copyPage);

    const result = await checkCopyStaleness(copyPage as never);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
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
