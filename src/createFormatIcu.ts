import IntlMessageFormat from "intl-messageformat";

export type FormatterMiddlewareFormatParams = {
  translation: string;
  language: string;
  params: Record<string, any> | undefined;
};

export type FinalFormatterMiddleware = {
  format: (props: FormatterMiddlewareFormatParams) => any;
};

export const createFormatIcu = (): FinalFormatterMiddleware => {
  const locales = new Map() as Map<string, string>;

  function isLocaleValid(locale: string) {
    try {
      return Boolean(Intl.NumberFormat.supportedLocalesOf(locale).length);
    } catch {
      return false;
    }
  }

  function getLanguage(language: string) {
    if (!locales.get(language)) {
      let localeCandidate: string = String(language).replace(/[^a-zA-Z]/g, "-");
      while (!isLocaleValid(localeCandidate)) {
        localeCandidate =
          localeCandidate.split("-").slice(0, -1).join("-") || "en";
      }
      locales.set(language, localeCandidate);
    }
    return locales.get(language);
  }

  const format: FinalFormatterMiddleware["format"] = ({
    translation,
    language,
    params,
  }) => {
    const ignoreTag = !Object.values(params || {}).find(
      (p) => typeof p === "function"
    );

    const locale = getLanguage(language);

    return new IntlMessageFormat(translation, locale, undefined, {
      ignoreTag,
    }).format(params);
  };

  return Object.freeze({ getLanguage, format });
};
