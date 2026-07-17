import type { NodeInfo } from "$shared/types";
import { collectNamespaceNames, namespacedKeyLabel } from "$ui/lib/logic/namespaces";
import { describe, expect, it } from "vitest";

describe("namespacedKeyLabel", () => {
  it("prefixes the namespace when namespaces are enabled", () => {
    expect(namespacedKeyLabel("common", "hello", true)).toBe("common.hello");
  });

  it("omits the prefix when there is no namespace", () => {
    expect(namespacedKeyLabel(undefined, "hello", true)).toBe("hello");
  });

  it("omits the prefix when namespaces are disabled, even with a namespace present", () => {
    expect(namespacedKeyLabel("common", "hello", false)).toBe("hello");
  });
});

describe("collectNamespaceNames", () => {
  it("merges server, node, and default namespaces, deduped and sorted", () => {
    const names = collectNamespaceNames(
      [{ name: "b" }, { name: "a" }],
      [{ ns: "c" }, { ns: "a" }] as NodeInfo[],
      "d",
    );
    expect(names).toEqual(["a", "b", "c", "d"]);
  });
});
