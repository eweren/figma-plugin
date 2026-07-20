import type { NodeInfo } from "$shared/types";
import type { PulledKey } from "$ui/lib/api/pull";
import { formatNodeText, pullDiff } from "$ui/lib/logic/pullDiff";
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

function makeRemoteKey(overrides: Partial<PulledKey> = {}): PulledKey {
  return {
    keyName: overrides.keyName ?? "",
    keyNamespace: overrides.keyNamespace,
    isPlural: overrides.isPlural ?? false,
    translations: overrides.translations ?? {},
  };
}

describe("pullDiff", () => {
  it("classifies a node as changed when remote text differs", () => {
    const node = makeNode({
      key: "greeting",
      translation: "Hello",
      connected: true,
    });
    const remote = makeRemoteKey({
      keyName: "greeting",
      translations: { en: { text: "Hi" } },
    });
    const diff = pullDiff([node], [remote], "en");

    expect(diff.changedNodes).toHaveLength(1);
    expect(diff.changedNodes[0]?.node).toBe(node);
    expect(diff.changedNodes[0]?.newText).toBe("Hi");
    expect(diff.changedNodes[0]?.isPlural).toBe(false);
    expect(diff.missingKeys).toEqual([]);
    expect(diff.unchangedNodes).toEqual([]);
  });

  it("classifies a node as missing when remote has no matching key", () => {
    const node = makeNode({
      key: "ghost",
      translation: "Hello",
      connected: true,
    });
    const diff = pullDiff([node], [], "en");

    expect(diff.missingKeys).toHaveLength(1);
    expect(diff.missingKeys[0]).toBe(node);
    expect(diff.changedNodes).toEqual([]);
    expect(diff.unchangedNodes).toEqual([]);
  });

  it("classifies a node as unchanged when remote text matches", () => {
    const node = makeNode({
      key: "greeting",
      translation: "Hello",
      connected: true,
    });
    const remote = makeRemoteKey({
      keyName: "greeting",
      translations: { en: { text: "Hello" } },
    });
    const diff = pullDiff([node], [remote], "en");

    expect(diff.unchangedNodes).toHaveLength(1);
    expect(diff.unchangedNodes[0]).toBe(node);
    expect(diff.changedNodes).toEqual([]);
    expect(diff.missingKeys).toEqual([]);
  });

  it("does NOT re-download a formatted string whose canvas is the tag-stripped render (Zuzka's perpetual '2 strings')", () => {
    // After a successful download, the canvas holds the PLAIN text ("Tučný
    // text" in a bold font) while `translation` holds the raw markup. The
    // drift check must compare against what apply would WRITE, not the raw
    // remote text — otherwise every formatted string re-downloads forever.
    const node = makeNode({
      key: "Advaced-BoldText",
      translation: "<b>Tučný text</b>",
      characters: "Tučný text",
      connected: true,
    });
    const remote = makeRemoteKey({
      keyName: "Advaced-BoldText",
      translations: { cs: { text: "<b>Tučný text</b>" } },
    });
    const diff = pullDiff([node], [remote], "cs");

    expect(diff.changedNodes).toEqual([]);
    expect(diff.unchangedNodes).toEqual([node]);
  });

  it("still re-applies a formatted string whose canvas GENUINELY drifted", () => {
    const node = makeNode({
      key: "Advaced-BoldText",
      translation: "<b>Tučný text</b>",
      characters: "někdo to přepsal",
      connected: true,
    });
    const remote = makeRemoteKey({
      keyName: "Advaced-BoldText",
      translations: { cs: { text: "<b>Tučný text</b>" } },
    });
    const diff = pullDiff([node], [remote], "cs");

    expect(diff.changedNodes).toHaveLength(1);
    expect(diff.changedNodes[0]?.newText).toBe("<b>Tučný text</b>");
  });

  it("treats <br> as the newline it becomes on canvas, not as drift", () => {
    const node = makeNode({
      key: "two-lines",
      translation: "první<br/>druhý",
      characters: "první\ndruhý",
      connected: true,
    });
    const remote = makeRemoteKey({
      keyName: "two-lines",
      translations: { cs: { text: "první<br/>druhý" } },
    });
    const diff = pullDiff([node], [remote], "cs");

    expect(diff.changedNodes).toEqual([]);
    expect(diff.unchangedNodes).toEqual([node]);
  });

  it("treats ICU quote-escaping ('' -> ') as rendered, not as drift", () => {
    const node = makeNode({
      key: "apostrophe",
      translation: "It''s done",
      characters: "It's done",
      connected: true,
    });
    const remote = makeRemoteKey({
      keyName: "apostrophe",
      translations: { en: { text: "It''s done" } },
    });
    const diff = pullDiff([node], [remote], "en");

    expect(diff.changedNodes).toEqual([]);
    expect(diff.unchangedNodes).toEqual([node]);
  });

  it("never flags drift when the remote ICU cannot be rendered", () => {
    const node = makeNode({
      key: "broken",
      translation: "{unclosed",
      characters: "whatever is on canvas",
      connected: true,
    });
    const remote = makeRemoteKey({
      keyName: "broken",
      translations: { en: { text: "{unclosed" } },
    });
    const diff = pullDiff([node], [remote], "en");

    expect(diff.changedNodes).toEqual([]);
    expect(diff.unchangedNodes).toEqual([node]);
  });

  it("classifies an empty remote translation as missing (no destructive overwrite)", () => {
    const node = makeNode({
      key: "greeting",
      translation: "Hello",
      connected: true,
    });
    const remote = makeRemoteKey({
      keyName: "greeting",
      translations: { en: { text: "" } },
    });
    const diff = pullDiff([node], [remote], "en");

    // Matches legacy plugin behaviour: a key without a translation for the
    // selected language is surfaced under "missing" so the user can see they
    // still need to translate it. We never overwrite a local string with "".
    expect(diff.missingKeys).toHaveLength(1);
    expect(diff.missingKeys[0]).toBe(node);
    expect(diff.changedNodes).toEqual([]);
    expect(diff.unchangedNodes).toEqual([]);
  });

  it("ignores nodes that are not connected", () => {
    const node = makeNode({
      key: "greeting",
      translation: "Hello",
      connected: false,
    });
    const diff = pullDiff([node], [], "en");

    expect(diff.changedNodes).toEqual([]);
    expect(diff.missingKeys).toEqual([]);
    expect(diff.unchangedNodes).toEqual([]);
  });

  it("flags plural mismatch as changed even when text matches", () => {
    const node = makeNode({
      key: "items",
      translation: "1 item",
      isPlural: false,
      connected: true,
    });
    const remote = makeRemoteKey({
      keyName: "items",
      isPlural: true,
      translations: { en: { text: "1 item" } },
    });
    const diff = pullDiff([node], [remote], "en");

    expect(diff.changedNodes).toHaveLength(1);
    expect(diff.changedNodes[0]?.isPlural).toBe(true);
  });

  it("disambiguates by namespace", () => {
    const nodeA = makeNode({
      id: "a",
      key: "greeting",
      ns: "ui",
      translation: "Hi (UI)",
      connected: true,
    });
    const nodeB = makeNode({
      id: "b",
      key: "greeting",
      ns: "marketing",
      translation: "Hi (mkt)",
      connected: true,
    });
    const remoteUi = makeRemoteKey({
      keyName: "greeting",
      keyNamespace: "ui",
      translations: { en: { text: "Hi (UI)" } },
    });
    const remoteMkt = makeRemoteKey({
      keyName: "greeting",
      keyNamespace: "marketing",
      translations: { en: { text: "Hello (mkt)" } },
    });
    const diff = pullDiff([nodeA, nodeB], [remoteUi, remoteMkt], "en");

    expect(diff.unchangedNodes).toContain(nodeA);
    expect(diff.changedNodes).toHaveLength(1);
    expect(diff.changedNodes[0]?.node).toBe(nodeB);
    expect(diff.changedNodes[0]?.newText).toBe("Hello (mkt)");
  });
});

describe("formatNodeText", () => {
  it("formats a plural using the named sample from paramsValues (this UI's edit path)", () => {
    const node = makeNode({
      key: "items",
      paramsValues: { count: "3" }, // count edited as the plural var's sample
      isPlural: true,
    });
    const out = formatNodeText(node, "{count, plural, one {1 item} other {# items}}", "en");
    expect(out.text).toBe("3 items");
    expect(out.error).toBeUndefined();
  });

  it("uses a numeric pluralParamValue as the sample COUNT (original-file compat)", () => {
    // Files written by the published plugin store the count in pluralParamValue.
    const node = makeNode({
      key: "items",
      pluralParamValue: "10",
      isPlural: true,
    });
    const out = formatNodeText(node, "{count, plural, one {1 item} other {# items}}", "en");
    expect(out.error).toBeUndefined();
    expect(out.text).toBe("10 items");
  });

  it("defaults the plural count to 1 when nothing is stored", () => {
    const node = makeNode({ key: "items", isPlural: true });
    const out = formatNodeText(node, "{count, plural, one {# item} other {# items}}", "en");
    expect(out.error).toBeUndefined();
    expect(out.text).toBe("1 item");
  });

  it("ignores a non-numeric pluralParamValue left over as a name (no 'value items')", () => {
    const node = makeNode({ key: "items", pluralParamValue: "value", isPlural: true });
    const out = formatNodeText(node, "{count, plural, one {1 item} other {# items}}", "en");
    expect(out.error).toBeUndefined();
    expect(out.text).toBe("1 item");
    expect(out.text).not.toContain("value");
  });

  it("formats with explicit paramsValues taking precedence", () => {
    const node = makeNode({
      key: "greet",
      paramsValues: { name: "Alice" },
    });
    const out = formatNodeText(node, "Hello, {name}!", "en");
    expect(out.text).toBe("Hello, Alice!");
    expect(out.error).toBeUndefined();
  });

  it("seeds a missing named param with its own name (never literal braces)", () => {
    const node = makeNode({ key: "greet" }); // no sample stored
    const out = formatNodeText(node, "Hello, {name}!", "en");
    expect(out.text).toBe("Hello, name!");
    expect(out.text).not.toContain("{");
    expect(out.error).toBeUndefined();
  });

  it("does not overwrite an existing `count` in paramsValues", () => {
    // An explicit sample value in paramsValues wins over the seeded default.
    const node = makeNode({
      key: "items",
      pluralParamValue: "count",
      paramsValues: { count: "7" },
      isPlural: true,
    });
    const out = formatNodeText(node, "{count, plural, one {1 item} other {# items}}", "en");
    expect(out.text).toBe("7 items");
    expect(out.error).toBeUndefined();
  });

  it("keeps the node's canvas text (not raw ICU) and reports the Error on malformed ICU", () => {
    const node = makeNode({
      key: "broken",
      characters: "current canvas text",
      paramsValues: { name: "Alice" },
    });
    const out = formatNodeText(node, "Hello {name", "en");
    expect(out.text).toBe("current canvas text");
    expect(out.text).not.toContain("{name");
    expect(out.error).toBeInstanceOf(Error);
  });

  it("returns the raw text untouched when there are no params at all", () => {
    const node = makeNode({ key: "k" });
    const out = formatNodeText(node, "Just a string", "en");
    expect(out.text).toBe("Just a string");
    expect(out.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Task 59: a `keyNames`-filtered remote payload must diff identically to the
// unfiltered (full-project) one, for the exact same local nodes. `pullDiff`
// itself doesn't know or care how `remoteKeys` was fetched — this pins that
// invariant so the filtering change in `pull.ts` can never silently alter
// what counts as changed/unchanged/missing.
// ---------------------------------------------------------------------------

describe("pullDiff — filtered vs. full remote payload equivalence", () => {
  it("produces the identical diff whether remoteKeys is the full project or filtered to just the local nodes' keys", () => {
    const changed = makeNode({ id: "a", key: "greeting", translation: "Hello" });
    const unchanged = makeNode({ id: "b", key: "farewell", translation: "Bye" });
    const missing = makeNode({ id: "c", key: "deleted-key", translation: "Gone" });
    const localNodes = [changed, unchanged, missing];

    // The "full project" payload includes keys belonging to OTHER nodes not
    // in this selection at all (simulating everything else in the project).
    const fullRemote: PulledKey[] = [
      makeRemoteKey({ keyName: "greeting", translations: { en: { text: "Hi" } } }),
      makeRemoteKey({ keyName: "farewell", translations: { en: { text: "Bye" } } }),
      makeRemoteKey({ keyName: "unrelated-key", translations: { en: { text: "Noise" } } }),
    ];
    // The filtered payload contains only what `keyNames` (built from
    // localNodes) would have asked the server for — i.e. never
    // "unrelated-key", and (like the real API) never a payload entry for the
    // deleted key either.
    const filteredRemote: PulledKey[] = fullRemote.filter((k) => k.keyName !== "unrelated-key");

    const fullDiff = pullDiff(localNodes, fullRemote, "en");
    const filteredDiff = pullDiff(localNodes, filteredRemote, "en");

    expect(filteredDiff).toEqual(fullDiff);
    expect(filteredDiff.missingKeys.map((n) => n.id)).toEqual(["c"]);
    expect(filteredDiff.changedNodes.map((c) => c.node.id)).toEqual(["a"]);
    expect(filteredDiff.unchangedNodes.map((n) => n.id)).toEqual(["b"]);
  });
});
