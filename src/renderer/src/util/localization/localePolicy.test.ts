import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, isAllowedLocale, normalizeLocale } from "./localePolicy";

describe("locale policy", () => {
  it("accepts supported locale shapes", () => {
    expect(isAllowedLocale("en")).toBe(true);
    expect(isAllowedLocale("uk")).toBe(true);
    expect(isAllowedLocale("en-GB")).toBe(true);
  });

  it("rejects empty, malformed, and excluded locales", () => {
    expect(isAllowedLocale("")).toBe(false);
    expect(isAllowedLocale("not_a_locale")).toBe(false);
    expect(isAllowedLocale("ru")).toBe(false);
    expect(isAllowedLocale("ru-RU")).toBe(false);
  });

  it("normalizes an unusable locale to the explicit fallback", () => {
    expect(normalizeLocale("uk")).toBe("uk");
    expect(normalizeLocale("ru-RU")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("not_a_locale")).toBe(DEFAULT_LOCALE);
  });
});
