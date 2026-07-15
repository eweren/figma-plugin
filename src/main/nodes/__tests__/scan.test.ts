import { describe, expect, it, vi } from "vitest";

import { buildConnectedNodesInfo } from "$main/nodes/scan";

/** Minimal TEXT-node stand-in — just enough for `getNodeInfo` to read. */
function makeTextNode(id: string): TextNode {
  return {
    id,
    name: `Layer ${id}`,
    characters: `text ${id}`,
    visible: true,
    getPluginData: () => "",
  } as unknown as TextNode;
}

describe("buildConnectedNodesInfo", () => {
  it("reports progress every 50 nodes when total > 100, ending at done === total", async () => {
    const nodes = Array.from({ length: 250 }, (_, i) => makeTextNode(`1:${i}`));
    const onProgress = vi.fn();

    const infos = await buildConnectedNodesInfo(nodes, onProgress);

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

    const infos = await buildConnectedNodesInfo(nodes, onProgress);

    expect(infos).toHaveLength(100);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("builds correct NodeInfo entries regardless of progress reporting", async () => {
    const nodes = [makeTextNode("1:1"), makeTextNode("1:2")];

    const infos = await buildConnectedNodesInfo(nodes);

    expect(infos.map((i) => i.id)).toEqual(["1:1", "1:2"]);
    expect(infos.map((i) => i.characters)).toEqual(["text 1:1", "text 1:2"]);
  });
});
