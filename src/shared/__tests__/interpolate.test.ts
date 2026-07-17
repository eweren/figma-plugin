import type { NodeInfo } from "$shared/types";
import { describe, expect, it } from "vitest";
import {
  inferPluralCount,
  interpolatedText,
  isSimpleNode,
  renderIcuForNode,
  translationDiffersFromNode,
} from "$shared/interpolate";

const PLURAL = "{count, plural, one {# item} other {# items}}";

function makeNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
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
  } as NodeInfo;
}

describe("renderIcuForNode", () => {
  it("renders a plural with the count from a numeric pluralParamValue", () => {
    const node = makeNode({ isPlural: true, pluralParamValue: "10" });
    expect(renderIcuForNode(PLURAL, node, "en").text).toBe("10 items");
  });

  it("prefers a named sample in paramsValues over pluralParamValue", () => {
    const node = makeNode({ isPlural: true, pluralParamValue: "10", paramsValues: { count: "1" } });
    expect(renderIcuForNode(PLURAL, node, "en").text).toBe("1 item");
  });

  it("defaults the count to 1 and never injects a non-numeric value", () => {
    const node = makeNode({ isPlural: true, pluralParamValue: "value" });
    expect(renderIcuForNode(PLURAL, node, "en").text).toBe("1 item");
  });

  it("returns the raw text and an error on malformed ICU", () => {
    const node = makeNode({ paramsValues: { name: "x" } });
    const out = renderIcuForNode("Hello {name", node, "en");
    expect(out.text).toBe("Hello {name");
    expect(out.error).toBeInstanceOf(Error);
  });
});

describe("isSimpleNode", () => {
  it("is true for a plain string with no params/markup", () => {
    expect(isSimpleNode(makeNode({ translation: "Hello" }))).toBe(true);
  });
  it("is false for a plural / params / markup", () => {
    expect(isSimpleNode(makeNode({ isPlural: true }))).toBe(false);
    expect(isSimpleNode(makeNode({ paramsValues: { a: "1" } }))).toBe(false);
    expect(isSimpleNode(makeNode({ translation: "<b>Hi</b>" }))).toBe(false);
  });
});

describe("translationDiffersFromNode (manual change)", () => {
  it("flags a plural whose canvas was edited away from its rendered form", () => {
    const node = makeNode({
      isPlural: true,
      translation: PLURAL,
      pluralParamValue: "10",
      characters: "10 kittens", // edited on canvas, should be "10 items"
    });
    expect(translationDiffersFromNode(node, "en")).toBe(true);
  });

  it("does NOT flag a plural whose canvas matches its rendered form", () => {
    const node = makeNode({
      isPlural: true,
      translation: PLURAL,
      pluralParamValue: "10",
      characters: "10 items",
    });
    expect(translationDiffersFromNode(node, "en")).toBe(false);
  });

  it("does NOT flag a simple (plain) string", () => {
    const node = makeNode({ translation: "Hello", characters: "Hello, world (edited)" });
    expect(translationDiffersFromNode(node, "en")).toBe(false);
  });

  it("ignores inline markup when comparing", () => {
    const node = makeNode({ translation: "<b>Hi</b>", characters: "Hi" });
    expect(translationDiffersFromNode(node, "en")).toBe(false);
  });
});

describe("inferPluralCount", () => {
  it("finds the count that renders the canvas form", () => {
    expect(inferPluralCount(PLURAL, "5 items", "en")).toBe("5");
    expect(inferPluralCount(PLURAL, "1 item", "en")).toBe("1");
  });
  it("returns undefined when nothing matches or it isn't a plural", () => {
    expect(inferPluralCount(PLURAL, "totally different", "en")).toBeUndefined();
    expect(inferPluralCount("Just a string", "Just a string", "en")).toBeUndefined();
  });
});

describe("interpolatedText", () => {
  it("renders the stored translation for an advanced node", () => {
    const node = makeNode({ isPlural: true, translation: PLURAL, pluralParamValue: "2" });
    expect(interpolatedText(node, "en").text).toBe("2 items");
  });
  it("uses raw characters for a simple node", () => {
    const node = makeNode({ translation: "Hello", characters: "Hello" });
    expect(interpolatedText(node, "en").text).toBe("Hello");
  });
});
