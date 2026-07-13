import type { NodeInfo } from "$shared/types";
import { describe, expect, it } from "vitest";
import { hasManualChange } from "$ui/lib/logic/manualChange";

const PLURAL = "{value, plural, one {# woman} other {# women}}";

function makeNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id: "n",
    name: "Layer",
    characters: "",
    translation: "",
    isPlural: false,
    key: "plural-W",
    ns: undefined,
    connected: false,
    ...overrides,
  } as NodeInfo;
}

describe("hasManualChange", () => {
  it("flags an UNCONNECTED plural whose canvas was edited (matches the original)", () => {
    // Regression: the rewrite gated on `connected`, so a locally-created plural
    // edited on canvas ("9 women-" vs the rendered "9 women") showed no warning.
    const node = makeNode({
      isPlural: true,
      connected: false,
      translation: PLURAL,
      pluralParamValue: "9",
      characters: "9 women-",
    });
    expect(hasManualChange(node, "en")).toBe(true);
  });

  it("does NOT flag a plural whose canvas matches its render", () => {
    const node = makeNode({
      isPlural: true,
      connected: false,
      translation: PLURAL,
      pluralParamValue: "9",
      characters: "9 women",
    });
    expect(hasManualChange(node, "en")).toBe(false);
  });

  it("does NOT flag a plain string (only advanced strings can diverge)", () => {
    const node = makeNode({
      connected: true,
      translation: "Hello",
      characters: "Hello, edited",
    });
    expect(hasManualChange(node, "en")).toBe(false);
  });

  it("does NOT flag a node with no stored translation", () => {
    const node = makeNode({ isPlural: true, translation: "", characters: "10 women" });
    expect(hasManualChange(node, "en")).toBe(false);
  });
});
