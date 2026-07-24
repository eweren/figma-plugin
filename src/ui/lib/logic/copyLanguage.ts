import type { TolgeeConfig } from "$shared/types";

/**
 * A page copy's language, read from its NAME suffix — e.g. "Home - cs" → "cs".
 *
 * Both this plugin and the ORIGINAL name a language copy `${sourceName} - ${lang}`
 * (and a keys copy `${sourceName} - keys`), so the suffix is a backward-compatible
 * signal that survives even when the stored/merged config language gets repointed.
 * Validated against the project's known language tags so a source name that itself
 * ends in " - X" (e.g. "Docs - API", or the "- keys" of a keys copy) is never
 * mistaken for a language.
 */
export function copyLanguageFromPageName(
  pageName: string | undefined,
  knownTags: ReadonlySet<string>,
): string | undefined {
  if (!pageName) return undefined;
  const i = pageName.lastIndexOf(" - ");
  if (i < 0) return undefined;
  const suffix = pageName.slice(i + 3).trim();
  return suffix && knownTags.has(suffix) ? suffix : undefined;
}

/**
 * The language a page copy actually holds — resolved most-reliable first, so
 * Recreate/Download always target the language the copy was made in:
 *
 *   1. `copyLanguage` — the immutable marker this plugin writes on new copies
 *      (survives even a page rename);
 *   2. the page-name suffix — backward-compatible with the original plugin and
 *      with copies made before the marker existed;
 *   3. `config.language` — last resort. It's the selectable Push/Pull language,
 *      which shares the page scope and can be repointed to the main/default —
 *      exactly why (1) and (2) take precedence.
 *
 * Returns undefined for a "keys" copy (no language).
 */
export function resolveCopyLanguage(
  config: Partial<TolgeeConfig> | null | undefined,
  pageName: string | undefined,
  knownTags: ReadonlySet<string>,
): string | undefined {
  return (
    config?.copyLanguage ||
    copyLanguageFromPageName(pageName, knownTags) ||
    config?.language ||
    undefined
  );
}
