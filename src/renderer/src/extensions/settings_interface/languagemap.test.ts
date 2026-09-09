import { describe, expect, it } from "vitest";

import { languageCodeByEnglishName, languageExists, nativeLanguageName } from "./languagemap";

describe("UI language registry", () => {
  it("keeps Ukrainian available", () => {
    expect(languageExists("uk")).toBe(true);
    expect(languageCodeByEnglishName("Ukrainian")).toBe("uk");
    expect(nativeLanguageName("uk")).toBe("Українська");
  });

  it("does not register Russian as an available UI localization", () => {
    expect(languageExists("ru")).toBe(false);
    expect(languageCodeByEnglishName("Russian")).toBeUndefined();
  });
});
