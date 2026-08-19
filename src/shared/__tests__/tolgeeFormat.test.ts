import {
  findPluralParameters,
  getTolgeeFormat,
  tolgeeFormatGenerateIcu,
} from "$shared/tolgeeFormat";
import IntlMessageFormat from "intl-messageformat";
import { describe, expect, it } from "vitest";

/**
 * The whole point of `tolgeeFormatGenerateIcu`'s bug fixes is that the ICU it
 * produces must be ACCEPTED (parsed and formatted) by `intl-messageformat` —
 * the same library every render path in this app uses (`src/shared/icu.ts`).
 * Assert that directly instead of just checking the string shape.
 */
function expectValidIcu(icu: string): void {
  expect(() => {
    if (icu === "") return; // empty string is a valid "no message" sentinel, not ICU
    const formatter = new IntlMessageFormat(icu, "en", undefined, { ignoreTag: true });
    formatter.format({ value: 1, p: 1, count: 1, name: "x" });
  }).not.toThrow();
}

describe("getTolgeeFormat (non-plural)", () => {
  it("wraps plain text as the `other` variant", () => {
    expect(getTolgeeFormat("Hello", false, false)).toEqual({
      variants: { other: "Hello" },
    });
  });

  it("does not parse ICU when plural=false, even if the text looks like one", () => {
    const input = "{count, plural, one {one item} other {# items}}";
    expect(getTolgeeFormat(input, false, false)).toEqual({
      variants: { other: input },
    });
  });

  it("preserves empty strings", () => {
    expect(getTolgeeFormat("", false, false)).toEqual({
      variants: { other: "" },
    });
  });
});

describe("getTolgeeFormat (plural)", () => {
  it("parses a basic plural form", () => {
    const result = getTolgeeFormat("{count, plural, one {one item} other {# items}}", true, false);
    expect(result.parameter).toBe("count");
    expect(result.variants.one).toBe("one item");
    expect(result.variants.other).toBe("# items");
  });

  it("parses `=0` style match keys", () => {
    const result = getTolgeeFormat(
      "{count, plural, =0 {no items} one {one item} other {many}}",
      true,
      false,
    );
    expect(result.parameter).toBe("count");
    expect(result.variants["=0"]).toBe("no items");
    expect(result.variants.one).toBe("one item");
    expect(result.variants.other).toBe("many");
  });

  it("handles whitespace between the param, keyword, and variants", () => {
    const result = getTolgeeFormat(
      "{ value , plural , other {# tests} one {# test} }",
      true,
      false,
    );
    expect(result.parameter).toBe("value");
    expect(result.variants.other).toBe("# tests");
    expect(result.variants.one).toBe("# test");
  });

  it("respects ICU `'` escaped braces inside variant bodies", () => {
    // The variant body contains a literal `{` via `'{'`. The closing brace of
    // the variant should be the one AFTER the literal, not the one inside.
    const input = "{variable, plural, one {'{'} other {}}";
    const result = getTolgeeFormat(input, true, false);
    expect(result.parameter).toBe("variable");
    // Body returned RAW (no unescape).
    expect(result.variants.one).toBe("'{'");
    expect(result.variants.other).toBe("");
  });

  it("falls back to no-plural when the input is malformed", () => {
    const malformed = "not an icu plural";
    expect(getTolgeeFormat(malformed, true, false)).toEqual({
      variants: { other: malformed },
    });
  });

  it("falls back when the select function is not `plural`", () => {
    const input = "{gender, select, female {she} male {he} other {they}}";
    const result = getTolgeeFormat(input, true, false);
    expect(result.variants.other).toBe(input);
    expect(result.parameter).toBeUndefined();
  });

  it("falls back when input has trailing content past the outer brace", () => {
    const input = "{count, plural, other {x}} trailing";
    const result = getTolgeeFormat(input, true, false);
    expect(result.variants.other).toBe(input);
    expect(result.parameter).toBeUndefined();
  });

  it("falls back when a variant name is empty", () => {
    const input = "{count, plural, {x}}";
    const result = getTolgeeFormat(input, true, false);
    expect(result.variants.other).toBe(input);
    expect(result.parameter).toBeUndefined();
  });

  it("normalizes equivalent ICU forms to the same shape (whitespace agnostic)", () => {
    const a = getTolgeeFormat("{count, plural, one {x} other {y}}", true, false);
    const b = getTolgeeFormat("{ count ,plural,one {x}    other {y} }", true, false);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("falls back when a variant name repeats", () => {
    const input = "{count, plural, one {x} one {y} other {z}}";
    const result = getTolgeeFormat(input, true, false);
    expect(result.variants.other).toBe(input);
    expect(result.parameter).toBeUndefined();
  });
});

describe("tolgeeFormatGenerateIcu", () => {
  it("keeps the normal two-category case byte-identical (golden case)", () => {
    const icu = tolgeeFormatGenerateIcu(
      { parameter: "value", variants: { one: "# day", other: "# days" } },
      false,
    );
    expect(icu).toBe("{value, plural, one {# day} other {# days}}");
    expectValidIcu(icu);
  });

  it("escapes a literal `{` in a variant body and still parses", () => {
    const icu = tolgeeFormatGenerateIcu(
      { parameter: "value", variants: { one: "co{unt", other: "items" } },
      false,
    );
    // Exact reference output from the real `@tginternal/editor@1.15.2` package.
    expect(icu).toBe("{value, plural, one {co'{'unt} other {items}}");
    expectValidIcu(icu);
  });

  it("escapes a literal `}` in a variant body and still parses", () => {
    const icu = tolgeeFormatGenerateIcu(
      { parameter: "value", variants: { one: "wrong}brace", other: "ok" } },
      false,
    );
    expect(icu).toBe("{value, plural, one {wrong'}'brace} other {ok}}");
    expectValidIcu(icu);
  });

  it("force-appends `other {}` when `other` is absent, and the result parses", () => {
    const icu = tolgeeFormatGenerateIcu({ parameter: "value", variants: { one: "# day" } }, false);
    // Exact reference output from the real `@tginternal/editor@1.15.2` package.
    expect(icu).toBe("{value, plural, one {# day} other {}}");
    expectValidIcu(icu);
  });

  it("mirrors `makePluralFromNumber`'s single-category auto-plural (StringDetails.svelte) and it must parse", () => {
    // This is exactly the shape `makePluralFromNumber()` builds: one detected
    // CLDR category, no `other`. Before the fix this produced ICU with no
    // `other` fallback, which `IntlMessageFormat` rejects outright.
    const icu = tolgeeFormatGenerateIcu({ parameter: "value", variants: { one: "# item" } }, false);
    expect(icu).toContain("other {}");
    expectValidIcu(icu);
  });

  it("returns \"\" when every variant body is empty", () => {
    expect(tolgeeFormatGenerateIcu({ parameter: "value", variants: { one: "", other: "" } }, false)).toBe(
      "",
    );
    expect(tolgeeFormatGenerateIcu({ parameter: "value", variants: {} }, false)).toBe("");
  });

  it("does NOT collapse to \"\" when a variant body is whitespace-only (matches reference: only exactly-empty strings count)", () => {
    const icu = tolgeeFormatGenerateIcu(
      { parameter: "value", variants: { one: "   ", other: "" } },
      false,
    );
    // Exact reference output from the real `@tginternal/editor@1.15.2` package.
    expect(icu).toBe("{value, plural, one {   } other {}}");
    expectValidIcu(icu);
  });

  it("leaves the non-plural passthrough (no parameter) untouched", () => {
    expect(tolgeeFormatGenerateIcu({ variants: { other: "plain text" } }, false)).toBe("plain text");
    expect(tolgeeFormatGenerateIcu({ variants: {} }, false)).toBe("");
  });
});

describe("tolgeeFormatGenerateIcu — literal vs. argument braces", () => {
  it("keeps a nested `{name}` argument interpolating instead of escaping it to text", () => {
    // Regression: the generator used to escape EVERY brace, so a legitimate
    // nested argument became literal text — and, because Push regenerates the
    // whole ICU through this path when merging plural layers, it was uploaded
    // in that corrupted form.
    const icu = tolgeeFormatGenerateIcu(
      { parameter: "count", variants: { one: "One for {name}", other: "# for {name}" } },
      false,
    );
    expect(icu).toBe("{count, plural, one {One for {name}} other {# for {name}}}");
    expectValidIcu(icu);

    const rendered = new IntlMessageFormat(icu, "en", undefined, { ignoreTag: true }).format({
      count: 1,
      name: "Zuzka",
    });
    expect(rendered).toBe("One for Zuzka");
  });

  it("does not re-escape a brace that is already ICU-escaped", () => {
    // Regression: `a '{' b` used to round-trip to `a ''{'' b` — a literal
    // apostrophe followed by an unclosed argument, which throws downstream.
    const icu = tolgeeFormatGenerateIcu(
      { parameter: "value", variants: { one: "a '{' b", other: "ok" } },
      false,
    );
    expect(icu).toBe("{value, plural, one {a '{' b} other {ok}}");
    expectValidIcu(icu);

    const rendered = new IntlMessageFormat(icu, "en", undefined, { ignoreTag: true }).format({
      value: 1,
    });
    expect(rendered).toBe("a { b");
  });

  it("still escapes prose that merely sits between braces", () => {
    // `{not an argument}` is not a valid ICU argument (the name would have to
    // be one unbroken token), so it must keep being escaped to literal text.
    const icu = tolgeeFormatGenerateIcu(
      { parameter: "value", variants: { one: "{not an argument}", other: "ok" } },
      false,
    );
    expect(icu).toBe("{value, plural, one {'{'not an argument'}'} other {ok}}");
    expectValidIcu(icu);
  });

  it("round-trips a variant body through parse → generate unchanged", () => {
    // The property that actually matters for Push: parsing an ICU string and
    // regenerating it must not alter it, or a no-op edit reads as a change.
    const original = "{count, plural, one {One for {name}} other {# for {name}}}";
    const parsed = getTolgeeFormat(original, true, false);
    expect(tolgeeFormatGenerateIcu(parsed, false)).toBe(original);
  });
});

describe("findPluralParameters", () => {
  it("finds a plural that is the whole string", () => {
    expect(findPluralParameters("{count, plural, one {# day} other {# days}}")).toEqual(["count"]);
  });

  it("finds a plural surrounded by literal text", () => {
    expect(findPluralParameters("{count, plural, one {# day} other {# days}} left")).toEqual([
      "count",
    ]);
    expect(findPluralParameters("Only {n, plural, other {# x}}!")).toEqual(["n"]);
  });

  it("finds a plural nested inside another argument", () => {
    expect(
      findPluralParameters("{gender, select, other {{count, plural, other {# replies}}}}"),
    ).toEqual(["count"]);
  });

  it("ignores a non-plural argument and an escaped literal brace", () => {
    expect(findPluralParameters("Hello, {name}!")).toEqual([]);
    expect(findPluralParameters("literal '{'count, plural'}'")).toEqual([]);
  });

  it("leaves getTolgeeFormat's stricter whole-string semantics alone", () => {
    // The two answer different questions on purpose: push diffing needs "is
    // this string ONE plural form?", which must stay false here, while the
    // render path needs "is there a plural anywhere in it?".
    const embedded = "{count, plural, one {# day} other {# days}} left";
    expect(getTolgeeFormat(embedded, true, false).parameter).toBeUndefined();
    expect(findPluralParameters(embedded)).toEqual(["count"]);
  });
});
