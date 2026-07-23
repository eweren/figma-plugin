import { afterEach, describe, expect, it, vi } from "vitest";

import { TOLGEE_NODE_INFO } from "$shared/constants";
import { clearPrefilledKeys } from "$main/nodes/clearPrefilled";

/** A TEXT-node stand-in whose pluginData is a live map, so a `setPluginData`
 *  from `clearPrefilledKeys` is observable via `getPluginData` afterward. */
function makeTextNode(id: string, info: Record<string, unknown> | null) {
  const store = new Map<string, string>();
  if (info) store.set(TOLGEE_NODE_INFO, JSON.stringify(info));
  return {
    id,
    type: "TEXT" as const,
    getPluginData: (key: string) => store.get(key) ?? "",
    setPluginData: (key: string, value: string) => {
      store.set(key, value);
    },
    /** Test helper (not part of the Figma API) — read back the parsed data. */
    _data: () => {
      const raw = store.get(TOLGEE_NODE_INFO);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    },
  };
}

type FakeNode = ReturnType<typeof makeTextNode>;

/** Installs a fake `figma` whose pages return `nodes` from the pluginData-
 *  filtered `findAllWithCriteria` (the same filter the real code relies on). */
function installFigma(pages: FakeNode[][]): void {
  const figma = {
    root: {
      children: pages.map((nodes) => ({
        type: "PAGE" as const,
        loadAsync: async () => {},
        findAllWithCriteria: (_criteria: unknown) => nodes,
      })),
    },
  };
  (globalThis as unknown as { figma: unknown }).figma = figma;
}

afterEach(() => {
  (globalThis as unknown as { figma?: unknown }).figma = undefined;
  vi.restoreAllMocks();
});

describe("clearPrefilledKeys", () => {
  it("clears the key of unconnected nodes that have one, leaving other fields", () => {
    const node = makeTextNode("1:1", {
      key: "auto.generated",
      connected: false,
      translation: "Hello",
      ns: "web",
    });
    installFigma([[node]]);

    return clearPrefilledKeys().then((cleared) => {
      expect(cleared).toBe(1);
      expect(node._data()).toEqual({
        key: "",
        connected: false,
        translation: "Hello",
        ns: "web",
      });
    });
  });

  it("never touches CONNECTED nodes (real Tolgee links)", async () => {
    const node = makeTextNode("1:1", { key: "linked", connected: true });
    installFigma([[node]]);

    const cleared = await clearPrefilledKeys();
    expect(cleared).toBe(0);
    expect(node._data()?.key).toBe("linked");
  });

  it("skips unconnected nodes that already have no key", async () => {
    const node = makeTextNode("1:1", { key: "", connected: false });
    installFigma([[node]]);

    const cleared = await clearPrefilledKeys();
    expect(cleared).toBe(0);
  });

  it("clears across every page in the document", async () => {
    const p1 = makeTextNode("1:1", { key: "a", connected: false });
    const p2 = makeTextNode("2:1", { key: "b", connected: false });
    const p2b = makeTextNode("2:2", { key: "c", connected: true }); // connected → kept
    installFigma([[p1], [p2, p2b]]);

    const cleared = await clearPrefilledKeys();
    expect(cleared).toBe(2);
    expect(p1._data()?.key).toBe("");
    expect(p2._data()?.key).toBe("");
    expect(p2b._data()?.key).toBe("c");
  });

  it("ignores nodes whose pluginData is unparseable, without throwing", async () => {
    const bad = makeTextNode("1:1", null);
    bad.setPluginData(TOLGEE_NODE_INFO, "{not json");
    const good = makeTextNode("1:2", { key: "x", connected: false });
    installFigma([[bad, good]]);

    const cleared = await clearPrefilledKeys();
    expect(cleared).toBe(1);
    expect(good._data()?.key).toBe("");
  });
});
