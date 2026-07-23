import { describe, expect, it } from "vitest";

import { getNodeInfo, setNodeInfo } from "$main/nodes/getNodeInfo";

/** Minimal TEXT-node stand-in with live pluginData. */
function makeTextNode(id = "1:1") {
  const store = new Map<string, string>();
  return {
    id,
    name: `Layer ${id}`,
    characters: "Hello",
    visible: true,
    getPluginData: (key: string) => store.get(key) ?? "",
    setPluginData: (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as TextNode;
}

describe("getNodeInfo / setNodeInfo — prefilledKey provenance marker", () => {
  it("persists prefilledKey and reads it back", () => {
    const node = makeTextNode();
    setNodeInfo(node, { key: "auto.key", prefilledKey: "auto.key", connected: false });
    expect(getNodeInfo(node).prefilledKey).toBe("auto.key");
    expect(getNodeInfo(node).key).toBe("auto.key");
  });

  it("a manual key edit keeps the STALE marker (key diverges from prefilledKey)", () => {
    const node = makeTextNode();
    // Prefill wrote an auto key + marker…
    setNodeInfo(node, { key: "auto.key", prefilledKey: "auto.key", connected: false });
    // …then a manual edit changes only the key (no prefilledKey in the patch).
    setNodeInfo(node, { key: "my.custom.key" });

    const info = getNodeInfo(node);
    expect(info.key).toBe("my.custom.key");
    // Marker unchanged → key !== prefilledKey → clearPrefilledKeys preserves it.
    expect(info.prefilledKey).toBe("auto.key");
  });

  it("a format regeneration updates both key and marker together", () => {
    const node = makeTextNode();
    setNodeInfo(node, { key: "old", prefilledKey: "old", connected: false });
    // Prefill regenerates under a new format: writes the new value to both.
    setNodeInfo(node, { key: "new", prefilledKey: "new" });

    const info = getNodeInfo(node);
    expect(info.key).toBe("new");
    expect(info.prefilledKey).toBe("new"); // stays in sync → still clearable
  });

  it("leaves prefilledKey undefined for a plain manual node", () => {
    const node = makeTextNode();
    setNodeInfo(node, { key: "hand.typed", connected: false });
    expect(getNodeInfo(node).prefilledKey).toBeUndefined();
  });
});
