import { beforeEach, describe, expect, it } from "vitest";

import type { NodeInfo, TolgeeConfig } from "$shared/types";
import { pendingPrefills, resetPrefillSettled } from "$ui/lib/logic/prefillKey";

function makeNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id: overrides.id ?? "1:1",
    name: "Layer",
    characters: "Sign in",
    key: "",
    ns: undefined,
    translation: "",
    isPlural: false,
    connected: false,
    ...overrides,
  };
}

const CONFIG: Partial<TolgeeConfig> = {
  prefillKeyFormat: true,
  keyFormat: "{elementText}",
  namespace: "",
};

beforeEach(() => {
  resetPrefillSettled();
});

describe("pendingPrefills", () => {
  it("fills empty-key unconnected nodes once, then settles", () => {
    const nodes = [makeNode({ id: "1:1" }), makeNode({ id: "1:2", characters: "Log out" })];
    const first = pendingPrefills(nodes, CONFIG);
    expect(first.map((p) => p.id)).toEqual(["1:1", "1:2"]);
    expect(first[0]?.key).toBe("Sign in");
    // Same selection again — already settled, nothing to persist.
    expect(pendingPrefills(nodes, CONFIG)).toEqual([]);
  });

  it("plugin open never rewrites keys persisted earlier (boot is not a format change)", () => {
    // Fresh session memory = reopen. Keyed nodes stay untouched, empty fill.
    const nodes = [
      makeNode({ id: "1:1", key: "my.manual.key" }),
      makeNode({ id: "1:2", characters: "Log out" }),
      makeNode({ id: "1:3", key: "linked", connected: true }),
    ];
    expect(pendingPrefills(nodes, CONFIG)).toEqual([
      { id: "1:2", key: "Log out", ns: "" },
    ]);
  });

  it("a cleared key stays cleared for the session", () => {
    const node = makeNode({ id: "1:1" });
    pendingPrefills([node], CONFIG); // prefill applied → settled
    const cleared = makeNode({ id: "1:1", key: "" }); // user deleted the key
    expect(pendingPrefills([cleared], CONFIG)).toEqual([]);
  });

  it("regenerates every unconnected key when the format changes (production parity)", () => {
    const nodes = [
      makeNode({ id: "1:1", key: "Sign in" }),
      makeNode({ id: "1:2", key: "manual.key", characters: "Log out" }),
      makeNode({ id: "1:3", key: "linked", connected: true }),
    ];
    pendingPrefills(nodes, CONFIG); // decisions made under {elementText}
    const regenerated = pendingPrefills(nodes, { ...CONFIG, keyFormat: "{elementName}" });
    // Both unconnected nodes get the new-format key; the connected one never.
    expect(regenerated).toEqual([
      { id: "1:1", key: "Layer", ns: "" },
      { id: "1:2", key: "Layer", ns: "" },
    ]);
  });

  it("a format change also refills keys the user had cleared", () => {
    const node = makeNode({ id: "1:1" });
    pendingPrefills([node], CONFIG);
    const cleared = makeNode({ id: "1:1", key: "" });
    pendingPrefills([cleared], CONFIG); // still cleared under the same format
    expect(pendingPrefills([cleared], { ...CONFIG, keyFormat: "{elementName}" })).toEqual([
      { id: "1:1", key: "Layer", ns: "" },
    ]);
  });

  it("regenerates when variable casing changes", () => {
    const node = makeNode({ id: "1:1" });
    pendingPrefills([node], CONFIG);
    const keyed = makeNode({ id: "1:1", key: "Sign in" });
    const regenerated = pendingPrefills([keyed], { ...CONFIG, variableCasing: "camelCase" });
    expect(regenerated).toEqual([{ id: "1:1", key: "signIn", ns: "" }]);
  });

  it("toggling prefill off is inert; re-enabling with a NEW format regenerates", () => {
    const node = makeNode({ id: "1:1" });
    const [applied] = pendingPrefills([node], CONFIG);
    const keyed = makeNode({ id: "1:1", key: applied?.key });
    expect(pendingPrefills([keyed], { prefillKeyFormat: false })).toEqual([]);
    expect(pendingPrefills([keyed], { ...CONFIG, keyFormat: "{elementName}" })).toEqual([
      { id: "1:1", key: "Layer", ns: "" },
    ]);
  });

  it("waits for parent names before generating from a parent-based format", () => {
    const node = makeNode({ id: "1:1", key: "old" });
    pendingPrefills([node], CONFIG); // decided under {elementText}
    const parentConfig = { ...CONFIG, keyFormat: "{frame}.{elementName}" };
    // Stale snapshot (scan under the old format resolved no ancestors) —
    // generating now would persist a partial key. Stay undecided instead.
    expect(pendingPrefills([node], parentConfig)).toEqual([]);
    // Re-scan delivered the frame → full key generated.
    const withParents = makeNode({ id: "1:1", key: "old", frame: "Login" });
    expect(pendingPrefills([withParents], parentConfig)).toEqual([
      { id: "1:1", key: "Login.Layer", ns: "" },
    ]);
  });
});
