import type { NodeInfo } from "$shared/types";
import { buildRemoteMapFromKeys, pushDiff } from "$ui/lib/logic/pushDiff";
import type { RemoteTranslationMap } from "$ui/lib/logic/pushDiff";
import { describe, expect, it } from "vitest";

function makeNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id: overrides.id ?? "node-1",
    name: overrides.name ?? "Node",
    characters: overrides.characters ?? "",
    translation: overrides.translation ?? "",
    isPlural: overrides.isPlural ?? false,
    key: overrides.key ?? "",
    ns: overrides.ns,
    connected: overrides.connected ?? true,
    visible: overrides.visible,
    paramsValues: overrides.paramsValues,
    pluralParamValue: overrides.pluralParamValue,
  };
}

describe("pushDiff", () => {
  it("returns empty buckets for empty input", () => {
    const diff = pushDiff([], {}, { hasNamespacesEnabled: false });
    expect(diff.newKeys).toEqual([]);
    expect(diff.changedKeys).toEqual([]);
    expect(diff.unchangedKeys).toEqual([]);
    expect(diff.conflictingNodes).toEqual([]);
  });

  it("marks a node as unchanged when remote text matches", () => {
    const node = makeNode({
      id: "n1",
      key: "greeting",
      translation: "Hello",
    });
    const remote: RemoteTranslationMap = {
      "": {
        greeting: {
          translation: "Hello",
          keyIsPlural: false,
          keyTags: [],
        },
      },
    };
    const diff = pushDiff([node], remote, { hasNamespacesEnabled: false });
    expect(diff.unchangedKeys).toHaveLength(1);
    expect(diff.unchangedKeys[0]).toBe(node);
    expect(diff.newKeys).toEqual([]);
    expect(diff.changedKeys).toEqual([]);
  });

  it("marks a node as changed and surfaces the remoteText when text differs", () => {
    const node = makeNode({
      id: "n1",
      key: "greeting",
      translation: "Hi",
    });
    const remote: RemoteTranslationMap = {
      "": {
        greeting: {
          translation: "Hello",
          keyIsPlural: false,
          keyTags: [],
        },
      },
    };
    const diff = pushDiff([node], remote, { hasNamespacesEnabled: false });
    expect(diff.changedKeys).toHaveLength(1);
    expect(diff.changedKeys[0]?.node).toBe(node);
    expect(diff.changedKeys[0]?.remoteText).toBe("Hello");
    expect(diff.unchangedKeys).toEqual([]);
  });

  it("marks an UNCONNECTED node as new when remote has no entry for the key", () => {
    const node = makeNode({
      id: "n1",
      key: "new-key",
      translation: "Hello",
      connected: false,
    });
    const diff = pushDiff([node], {}, { hasNamespacesEnabled: false });
    expect(diff.newKeys).toHaveLength(1);
    expect(diff.newKeys[0]).toBe(node);
    expect(diff.missingKeys).toEqual([]);
  });

  it("marks a CONNECTED node as missing (not new) when remote has no entry — the key was deleted on the platform", () => {
    const node = makeNode({
      id: "n1",
      key: "deleted-key",
      translation: "Hello",
      connected: true,
    });
    const diff = pushDiff([node], {}, { hasNamespacesEnabled: false });
    expect(diff.missingKeys).toHaveLength(1);
    expect(diff.missingKeys[0]).toBe(node);
    expect(diff.newKeys).toEqual([]);
  });

  it("reports two nodes with the same (key, ns) but different text as conflicting", () => {
    const nodeA = makeNode({
      id: "a",
      key: "shared",
      ns: "ui",
      translation: "Hello",
    });
    const nodeB = makeNode({
      id: "b",
      key: "shared",
      ns: "ui",
      translation: "Hi",
    });
    const diff = pushDiff([nodeA, nodeB], {}, { hasNamespacesEnabled: true });

    expect(diff.conflictingNodes).toHaveLength(1);
    expect(diff.conflictingNodes[0]?.key).toBe("shared");
    expect(diff.conflictingNodes[0]?.ns).toBe("ui");
    expect(diff.conflictingNodes[0]?.nodes).toHaveLength(2);
    expect(diff.conflictingNodes[0]?.nodes).toContain(nodeA);
    expect(diff.conflictingNodes[0]?.nodes).toContain(nodeB);
  });

  it("does NOT report duplicate (key, ns) pairs when the text agrees", () => {
    const nodeA = makeNode({
      id: "a",
      key: "shared",
      translation: "Hello",
    });
    const nodeB = makeNode({
      id: "b",
      key: "shared",
      translation: "Hello",
    });
    const diff = pushDiff([nodeA, nodeB], {}, { hasNamespacesEnabled: false });
    expect(diff.conflictingNodes).toEqual([]);
  });

  it("does NOT report plural VARIANTS as conflicting (same key + ICU, different rendered text)", () => {
    // Two Figma layers legitimately share one plural key: identical ICU in
    // `translation`, but each renders a different sample form ("1 woman" /
    // "10 women") in `characters`. `textOfNode` uses the ICU for plural/advanced
    // strings, so this must NOT trip the same-key conflict heuristic.
    const icu = "{count, plural, one {# woman} other {# women}}";
    const nodeA = makeNode({
      id: "a",
      key: "plural-W",
      isPlural: true,
      translation: icu,
      characters: "1 woman",
    });
    const nodeB = makeNode({
      id: "b",
      key: "plural-W",
      isPlural: true,
      translation: icu,
      characters: "10 women",
    });
    const diff = pushDiff([nodeA, nodeB], {}, { hasNamespacesEnabled: false });
    expect(diff.conflictingNodes).toEqual([]);
  });

  it("does NOT report plural variants as conflicting even without a stored ICU translation", () => {
    // The screenshot case: two plural layers on one key, no ICU pulled yet, so
    // `translation` is empty and only the rendered `characters` differ. A plural
    // render is derived, never authoritative, so this must not be a conflict.
    const nodeA = makeNode({
      id: "a",
      key: "plural-W",
      isPlural: true,
      translation: "",
      characters: "1 woman",
    });
    const nodeB = makeNode({
      id: "b",
      key: "plural-W",
      isPlural: true,
      translation: "",
      characters: "10 women",
    });
    const diff = pushDiff([nodeA, nodeB], {}, { hasNamespacesEnabled: false });
    expect(diff.conflictingNodes).toEqual([]);
  });

  it("flags plural mismatch as changed even when text matches", () => {
    const node = makeNode({
      id: "n1",
      key: "items",
      translation: "1 item",
      isPlural: true,
    });
    const remote: RemoteTranslationMap = {
      "": {
        items: {
          translation: "1 item",
          keyIsPlural: false,
          keyTags: [],
        },
      },
    };
    const diff = pushDiff([node], remote, { hasNamespacesEnabled: false });
    expect(diff.changedKeys).toHaveLength(1);
    expect(diff.changedKeys[0]?.node).toBe(node);
  });

  it("flags missing configuredTags as changed", () => {
    const node = makeNode({
      id: "n1",
      key: "greeting",
      translation: "Hello",
    });
    const remote: RemoteTranslationMap = {
      "": {
        greeting: {
          translation: "Hello",
          keyIsPlural: false,
          keyTags: ["existing"],
        },
      },
    };
    const diff = pushDiff([node], remote, {
      hasNamespacesEnabled: false,
      configuredTags: ["needs-this-tag"],
    });
    expect(diff.changedKeys).toHaveLength(1);
  });

  it("ignores nodes without a key", () => {
    const node = makeNode({ id: "n1", key: "", translation: "Hello" });
    const diff = pushDiff([node], {}, { hasNamespacesEnabled: false });
    expect(diff.newKeys).toEqual([]);
    expect(diff.changedKeys).toEqual([]);
    expect(diff.unchangedKeys).toEqual([]);
  });

  it("falls back to `characters` when `translation` is empty", () => {
    const node = makeNode({
      id: "n1",
      key: "greeting",
      translation: "",
      characters: "Hello",
    });
    const remote: RemoteTranslationMap = {
      "": {
        greeting: {
          translation: "Hello",
          keyIsPlural: false,
          keyTags: [],
        },
      },
    };
    const diff = pushDiff([node], remote, { hasNamespacesEnabled: false });
    expect(diff.unchangedKeys).toHaveLength(1);
  });
});

describe("buildRemoteMapFromKeys", () => {
  it("returns an empty object when keys is undefined", () => {
    expect(buildRemoteMapFromKeys(undefined, "en")).toEqual({});
  });

  it("indexes by namespace ('' for default) and key", () => {
    const map = buildRemoteMapFromKeys(
      [
        {
          keyName: "greeting",
          translations: { en: { text: "Hello" } },
        },
        {
          keyName: "greeting",
          keyNamespace: "ui",
          keyIsPlural: true,
          keyTags: [{ name: "foo" }],
          translations: { en: { text: "Hi" } },
        },
      ],
      "en",
    );

    expect(map[""]?.greeting?.translation).toBe("Hello");
    expect(map[""]?.greeting?.keyIsPlural).toBe(false);
    expect(map.ui?.greeting?.translation).toBe("Hi");
    expect(map.ui?.greeting?.keyIsPlural).toBe(true);
    expect(map.ui?.greeting?.keyTags).toEqual(["foo"]);
  });

  it("returns undefined translation when no language entry is present", () => {
    const map = buildRemoteMapFromKeys([{ keyName: "k", translations: {} }], "en");
    expect(map[""]?.k?.translation).toBeUndefined();
  });
});
