export const DEFAULT_LOCALE = "en";

const EXCLUDED_UI_LANGUAGE_CODES = new Set(["ru"]);

export function isAllowedLocale(locale: string): boolean {
  if (locale.trim() === "") return false;

  const language = locale.split("-")[0].toLowerCase();
  if (EXCLUDED_UI_LANGUAGE_CODES.has(language)) return false;

  try {
    new Intl.DateTimeFormat(locale).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeLocale(locale: string): string {
  return isAllowedLocale(locale) ? locale : DEFAULT_LOCALE;
}
