import type { TolgeeConfig } from "$shared/types";
import { copyLanguageFromPageName, resolveCopyLanguage } from "$ui/lib/logic/copyLanguage";
import { describe, expect, it } from "vitest";

const TAGS = new Set(["en", "cs", "de", "pt-BR"]);
const NO_TAGS = new Set<string>();

describe("copyLanguageFromPageName", () => {
  it("reads the language from the '…- <lang>' suffix", () => {
    expect(copyLanguageFromPageName("Page 1 - cs", TAGS)).toBe("cs");
    expect(copyLanguageFromPageName("Home - pt-BR", TAGS)).toBe("pt-BR");
  });

  it("works even before the project language list has loaded (tag-shape match)", () => {
    // The bug: on a copy page the language list is often still in flight, so
    // validating only against loaded tags failed and recreate fell back to en.
    expect(copyLanguageFromPageName("Page 1 - cs", NO_TAGS)).toBe("cs");
    expect(copyLanguageFromPageName("Home - zh-Hans", NO_TAGS)).toBe("zh-Hans");
  });

  it("takes the LAST segment when the source name itself contains ' - '", () => {
    expect(copyLanguageFromPageName("Docs - API - de", TAGS)).toBe("de");
  });

  it("ignores a suffix that is neither a known tag nor a language shape", () => {
    // A keys copy is named "… - keys"; and a plain source name ending in " - X".
    expect(copyLanguageFromPageName("Page 1 - keys", NO_TAGS)).toBeUndefined();
    expect(copyLanguageFromPageName("Docs - API", NO_TAGS)).toBeUndefined();
    expect(copyLanguageFromPageName("Docs - Landing", NO_TAGS)).toBeUndefined();
  });

  it("returns undefined with no suffix / no name", () => {
    expect(copyLanguageFromPageName("Page 1", TAGS)).toBeUndefined();
    expect(copyLanguageFromPageName(undefined, TAGS)).toBeUndefined();
  });
});

describe("resolveCopyLanguage — page name wins (self-healing, poison-proof)", () => {
  const cfg = (o: Partial<TolgeeConfig>) => o as Partial<TolgeeConfig>;

  it("uses the page-name suffix even when config.language was repointed to the main language", () => {
    // The reported bug: the copy is "Page 1 - cs" but the selectable language
    // reads 'en' — recreate must still target Czech, from the name.
    expect(resolveCopyLanguage(cfg({ language: "en" }), "Page 1 - cs", NO_TAGS)).toBe("cs");
  });

  it("lets the correct name override a stale/poisoned copyLanguage marker", () => {
    expect(
      resolveCopyLanguage(cfg({ copyLanguage: "en", language: "en" }), "Page 1 - cs", TAGS),
    ).toBe("cs");
  });

  it("falls back to the marker when the copy page was renamed off the pattern", () => {
    expect(resolveCopyLanguage(cfg({ copyLanguage: "cs", language: "en" }), "Renamed", TAGS)).toBe(
      "cs",
    );
  });

  it("uses the selectable language only as a last resort", () => {
    expect(resolveCopyLanguage(cfg({ language: "de" }), "Renamed", TAGS)).toBe("de");
  });

  it("returns undefined for a keys copy (name '…- keys', no marker/language)", () => {
    expect(resolveCopyLanguage(cfg({}), "Page 1 - keys", TAGS)).toBeUndefined();
  });
});
