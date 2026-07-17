import { describe, expect, it, vi } from "vitest";

import { buildConnectedNodesInfo } from "$main/nodes/scan";

/** Minimal TEXT-node stand-in — just enough for `getNodeInfo`/`shouldIgnoreNode`
 *  to read. `parent` defaults to a bare PAGE stand-in (no hidden ancestors). */
function makeTextNode(
  id: string,
  overrides: Partial<Omit<TextNode, "parent">> & { parent?: unknown } = {},
): TextNode {
  return {
    id,
    name: `Layer ${id}`,
    characters: `text ${id}`,
    visible: true,
    parent: { type: "PAGE" },
    getPluginData: () => "",
    ...overrides,
  } as unknown as TextNode;
}

describe("buildConnectedNodesInfo", () => {
  it("reports progress every 50 nodes when total > 100, ending at done === total", async () => {
    const nodes = Array.from({ length: 250 }, (_, i) => makeTextNode(`1:${i}`));
    const onProgress = vi.fn();

    const infos = await buildConnectedNodesInfo(nodes, {}, false, onProgress);

    expect(infos).toHaveLength(250);
    expect(onProgress).toHaveBeenCalledTimes(5);
    expect(onProgress.mock.calls).toEqual([
      [50, 250],
      [100, 250],
      [150, 250],
      [200, 250],
      [250, 250],
    ]);
    const last = onProgress.mock.calls.at(-1);
    expect(last?.[0]).toBe(last?.[1]);
  });

  it("sends no progress messages when total <= 100", async () => {
    const nodes = Array.from({ length: 100 }, (_, i) => makeTextNode(`1:${i}`));
    const onProgress = vi.fn();

    const infos = await buildConnectedNodesInfo(nodes, {}, false, onProgress);

    expect(infos).toHaveLength(100);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("builds correct NodeInfo entries regardless of progress reporting", async () => {
    const nodes = [makeTextNode("1:1"), makeTextNode("1:2")];

    const infos = await buildConnectedNodesInfo(nodes, {}, false);

    expect(infos.map((i) => i.id)).toEqual(["1:1", "1:2"]);
    expect(infos.map((i) => i.characters)).toEqual(["text 1:1", "text 1:2"]);
  });

  it("skips nodes the ignore settings would exclude, same as a with-selection scan", async () => {
    const nodes = [
      makeTextNode("1:1"),
      makeTextNode("1:2", { characters: "42" }), // pure digits, ignoreNumbers default on
      makeTextNode("1:3", { visible: false }), // self-hidden, ignoreHiddenLayers default on
    ];

    const infos = await buildConnectedNodesInfo(nodes, {}, false);

    expect(infos.map((i) => i.id)).toEqual(["1:1"]);
  });

  it("does not check ancestor visibility when needsAncestorHidden is false", async () => {
    const hiddenParent = { type: "FRAME", visible: false, parent: { type: "PAGE" } };
    const nodes = [makeTextNode("1:1", { parent: hiddenParent })];

    const infos = await buildConnectedNodesInfo(nodes, { ignoreHiddenLayersIncludingChildren: true }, false);

    expect(infos.map((i) => i.id)).toEqual(["1:1"]);
  });

  it("skips nodes under a hidden ancestor when needsAncestorHidden is true", async () => {
    const hiddenParent = { type: "FRAME", visible: false, parent: { type: "PAGE" } };
    const nodes = [
      makeTextNode("1:1", { parent: hiddenParent }),
      makeTextNode("1:2"), // parent is the plain PAGE stand-in, not hidden
    ];

    const infos = await buildConnectedNodesInfo(
      nodes,
      { ignoreHiddenLayersIncludingChildren: true },
      true,
    );

    expect(infos.map((i) => i.id)).toEqual(["1:2"]);
  });
});
