import { afterEach, describe, expect, it, vi } from "vitest";
import { TOLGEE_NODE_INFO, TOLGEE_PLUGIN_CONFIG_NAME } from "$shared/constants";
import { checkCopyStaleness, removeExistingCopyPages } from "../createCopy";

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
  const figma = {
    root: { children: pages },
    currentPage: currentPage ?? pages[0],
    getNodeByIdAsync: async (id: string) => pages.find((p) => p.id === id) ?? null,
    // The sync `figma.currentPage` SETTER throws under dynamic-page access —
    // production code must only ever switch via this async API.
    setCurrentPageAsync: async (page: FakePage) => {
      figma.currentPage = page;
    },
    mixed: Symbol("mixed"),
  };
  (globalThis as unknown as { figma: unknown }).figma = figma;
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
      removedCount: 0,
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
      removedCount: 0,
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
      removedCount: 0,
    });
  });

  it("counts an ADDITIONAL node connected to an already-connected key (set-diff regression)", async () => {
    // Real-world repro: the source already had key "a" connected on one node
    // when the copy was made; the user then connected a SECOND node to that
    // same key. A set-based diff sees no new key and stays silent — but the
    // copy's clone of that second node predates the connection, so Download
    // will never touch it. Counts must flag it.
    const source = page("Home", undefined, {
      id: "src",
      textNodes: [textNode({ key: "a" }), textNode({ key: "a" })],
    });
    const copyPage = page(
      "Home — en",
      { pageCopy: true, sourcePageId: "src", language: "en" },
      { id: "copy", textNodes: [textNode({ key: "a" })] },
    );
    setPages([source, copyPage], copyPage);

    await expect(checkCopyStaleness(copyPage as never)).resolves.toEqual({
      ok: true,
      missingCount: 1,
      removedCount: 0,
    });
  });

  it("reports strings the source LOST as removedCount, never as negative missing", async () => {
    // The copy has a surplus on key "a" (the source lost a node since the
    // copy was made). That surplus must surface as `removedCount` — and per-
    // key maxes keep it from cancelling genuine missing counts elsewhere.
    const source = page("Home", undefined, {
      id: "src",
      textNodes: [textNode({ key: "a" }), textNode({ key: "b" })],
    });
    const copyPage = page(
      "Home — en",
      { pageCopy: true, sourcePageId: "src", language: "en" },
      {
        id: "copy",
        textNodes: [textNode({ key: "a" }), textNode({ key: "a" }), textNode({ key: "b" })],
      },
    );
    setPages([source, copyPage], copyPage);

    await expect(checkCopyStaleness(copyPage as never)).resolves.toEqual({
      ok: true,
      missingCount: 0,
      removedCount: 1,
    });
  });

  it("counts both directions independently in one check", async () => {
    // Source gained key "c" AND lost one "a" node; neither direction may
    // cancel the other.
    const source = page("Home", undefined, {
      id: "src",
      textNodes: [textNode({ key: "a" }), textNode({ key: "c" })],
    });
    const copyPage = page(
      "Home — en",
      { pageCopy: true, sourcePageId: "src", language: "en" },
      { id: "copy", textNodes: [textNode({ key: "a" }), textNode({ key: "a" })] },
    );
    setPages([source, copyPage], copyPage);

    await expect(checkCopyStaleness(copyPage as never)).resolves.toEqual({
      ok: true,
      missingCount: 1,
      removedCount: 1,
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

// NOTE: the per-node render logic (formerly `resolveCopyNodeText` here) moved
// to the UI — `$ui/lib/logic/copyApply`'s `buildCopyUpdates` — because ICU
// rendering needs `Intl`, which Figma's main-thread sandbox doesn't provide.
// Its regression tests live in `src/ui/lib/logic/__tests__/copyApply.test.ts`.
