import type { TolgeeConfig } from "$shared/types";
import { copyLanguageFromPageName, resolveCopyLanguage } from "$ui/lib/logic/copyLanguage";
import { describe, expect, it } from "vitest";

const TAGS = new Set(["en", "cs", "de", "pt-BR"]);

describe("copyLanguageFromPageName", () => {
  it("reads the language from the '…- <lang>' suffix", () => {
    expect(copyLanguageFromPageName("Page 1 - cs", TAGS)).toBe("cs");
    expect(copyLanguageFromPageName("Home - pt-BR", TAGS)).toBe("pt-BR");
  });

  it("takes the LAST segment when the source name itself contains ' - '", () => {
    expect(copyLanguageFromPageName("Docs - API - de", TAGS)).toBe("de");
  });

  it("ignores a suffix that is not a known language tag", () => {
    // A keys copy is named "… - keys"; and a plain source name ending in " - X".
    expect(copyLanguageFromPageName("Page 1 - keys", TAGS)).toBeUndefined();
    expect(copyLanguageFromPageName("Docs - API", TAGS)).toBeUndefined();
  });

  it("returns undefined with no suffix / no name", () => {
    expect(copyLanguageFromPageName("Page 1", TAGS)).toBeUndefined();
    expect(copyLanguageFromPageName(undefined, TAGS)).toBeUndefined();
  });
});

describe("resolveCopyLanguage — most reliable first", () => {
  const cfg = (o: Partial<TolgeeConfig>) => o as Partial<TolgeeConfig>;

  it("prefers the immutable copyLanguage marker (survives a rename)", () => {
    expect(
      resolveCopyLanguage(cfg({ copyLanguage: "cs", language: "en" }), "Renamed page", TAGS),
    ).toBe("cs");
  });

  it("falls back to the page-name suffix for pre-marker / original-plugin copies", () => {
    // The reported bug: no marker, and the selectable `language` was repointed to
    // the main/default 'en' — the name still says 'cs', so recreate stays Czech.
    expect(resolveCopyLanguage(cfg({ language: "en" }), "Page 1 - cs", TAGS)).toBe("cs");
  });

  it("uses the selectable language only as a last resort", () => {
    expect(resolveCopyLanguage(cfg({ language: "de" }), "Page 1", TAGS)).toBe("de");
  });

  it("returns undefined for a keys copy (no marker, no lang suffix, no config language)", () => {
    expect(resolveCopyLanguage(cfg({}), "Page 1 - keys", TAGS)).toBeUndefined();
  });
});
