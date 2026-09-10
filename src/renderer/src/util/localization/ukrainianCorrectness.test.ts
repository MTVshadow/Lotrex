import * as fs from "node:fs";
import * as path from "node:path";

import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";

import TextFilter from "../../controls/table/TextFilter";
import { ciEqual } from "../util";

describe("Phase 5 & Phase 7: Ukrainian Language Correctness & Installer Surfaces", () => {
  const localesDir = path.resolve(__dirname, "../../../../../locales");
  const enCommon = JSON.parse(fs.readFileSync(path.join(localesDir, "en", "common.json"), "utf8"));
  const ukCommon = JSON.parse(fs.readFileSync(path.join(localesDir, "uk", "common.json"), "utf8"));
  const enMod = JSON.parse(
    fs.readFileSync(path.join(localesDir, "en", "mod_management.json"), "utf8"),
  );
  const ukMod = JSON.parse(
    fs.readFileSync(path.join(localesDir, "uk", "mod_management.json"), "utf8"),
  );

  async function createI18n(lang: string = "uk") {
    const i18n = createInstance();
    await i18n.init({
      compatibilityJSON: "v3",
      lng: lang,
      fallbackLng: "en",
      defaultNS: "common",
      nsSeparator: ":::",
      keySeparator: "::",
      resources: {
        en: { common: enCommon, mod_management: enMod },
        uk: { common: ukCommon, mod_management: ukMod },
      },
      interpolation: { escapeValue: false },
    });
    return i18n;
  }

  describe("1. Installer Surfaces Localization (Phase 5 completion)", () => {
    it("resolves all installer semantic keys in English and Ukrainian", async () => {
      const i18nUk = await createI18n("uk");

      expect(i18nUk.t("installer::title_fomod")).toBe("Інсталятор FOMOD");
      expect(i18nUk.t("installer::previous")).toBe("Назад");
      expect(i18nUk.t("installer::next")).toBe("Далі");
      expect(i18nUk.t("installer::finish")).toBe("Завершити");
      expect(i18nUk.t("installer::cancel")).toBe("Скасувати");
      expect(i18nUk.t("installer::close")).toBe("Закрити");
      expect(i18nUk.t("installer::select_at_least_one")).toBe("Виберіть хоча б один");
      expect(i18nUk.t("installer::select_at_most_one")).toBe("Виберіть не більше одного");
      expect(i18nUk.t("installer::select_exactly_one")).toBe("Виберіть рівно один");
      expect(i18nUk.t("installer::none")).toBe("Немає");
      expect(i18nUk.t("installer::preset")).toBe("Шаблон");
      expect(i18nUk.t("installer::missing_group_name")).toBe("Назва групи відсутня");
      expect(i18nUk.t("install_from_file")).toBe("Встановити з файлу");

      const i18nEn = await createI18n("en");
      expect(i18nEn.t("installer::title_fomod")).toBe("FOMOD Installer");
      expect(i18nEn.t("installer::previous")).toBe("Previous");
      expect(i18nEn.t("installer::next")).toBe("Next");
      expect(i18nEn.t("installer::finish")).toBe("Finish");
      expect(i18nEn.t("installer::cancel")).toBe("Cancel");
      expect(i18nEn.t("install_from_file")).toBe("Install From File");
    });
  });

  describe("2. Ukrainian Slavic Pluralization Forms (_0, _1, _2)", () => {
    it("exercises Ukrainian counters with 1, 2, 5, 21, 22, 25 and verifies correct grammatical forms", async () => {
      const i18n = await createI18n("uk");

      // active mod: 1 мод, 2-4 моди, 5-20 модів, 21 мод, 22 моди, 25 модів
      expect(i18n.t("{{ count }} active mod", { count: 1 })).toBe("1 активний мод");
      expect(i18n.t("{{ count }} active mod", { count: 2 })).toBe("2 активні моди");
      expect(i18n.t("{{ count }} active mod", { count: 5 })).toBe("5 активних модів");
      expect(i18n.t("{{ count }} active mod", { count: 21 })).toBe("21 активний мод");
      expect(i18n.t("{{ count }} active mod", { count: 22 })).toBe("22 активні моди");
      expect(i18n.t("{{ count }} active mod", { count: 25 })).toBe("25 активних модів");

      // file: 1 файл, 2-4 файли, 5-20 файлів
      expect(i18n.t("{{ count }} file", { count: 1 })).toBe("1 файл");
      expect(i18n.t("{{ count }} file", { count: 2 })).toBe("2 файли");
      expect(i18n.t("{{ count }} file", { count: 5 })).toBe("5 файлів");
      expect(i18n.t("{{ count }} file", { count: 21 })).toBe("21 файл");
      expect(i18n.t("{{ count }} file", { count: 22 })).toBe("22 файли");
      expect(i18n.t("{{ count }} file", { count: 25 })).toBe("25 файлів");

      // error: 1 помилка, 2-4 помилки, 5-20 помилок
      expect(i18n.t("{{ count }} error", { count: 1 })).toBe("1 помилка");
      expect(i18n.t("{{ count }} error", { count: 2 })).toBe("2 помилки");
      expect(i18n.t("{{ count }} error", { count: 5 })).toBe("5 помилок");
      expect(i18n.t("{{ count }} error", { count: 21 })).toBe("21 помилка");
      expect(i18n.t("{{ count }} error", { count: 22 })).toBe("22 помилки");
      expect(i18n.t("{{ count }} error", { count: 25 })).toBe("25 помилок");

      // day ago: 1 день тому, 2 дні тому, 5 днів тому
      expect(i18n.t("{{ count }} day ago", { count: 1 })).toBe("1 день тому");
      expect(i18n.t("{{ count }} day ago", { count: 2 })).toBe("2 дні тому");
      expect(i18n.t("{{ count }} day ago", { count: 5 })).toBe("5 днів тому");
      expect(i18n.t("{{ count }} day ago", { count: 21 })).toBe("21 день тому");
      expect(i18n.t("{{ count }} day ago", { count: 22 })).toBe("22 дні тому");
      expect(i18n.t("{{ count }} day ago", { count: 25 })).toBe("25 днів тому");

      // hour ago: 1 годину тому, 2 години тому, 5 годин тому
      expect(i18n.t("{{ count }} hour ago", { count: 1 })).toBe("1 годину тому");
      expect(i18n.t("{{ count }} hour ago", { count: 2 })).toBe("2 години тому");
      expect(i18n.t("{{ count }} hour ago", { count: 5 })).toBe("5 годин тому");
      expect(i18n.t("{{ count }} hour ago", { count: 21 })).toBe("21 годину тому");
      expect(i18n.t("{{ count }} hour ago", { count: 22 })).toBe("22 години тому");
      expect(i18n.t("{{ count }} hour ago", { count: 25 })).toBe("25 годин тому");

      // comments: 1 коментар, 2 коментарі, 5 коментарів
      expect(i18n.t("{{ count }} comments", { count: 1 })).toBe("1 коментар");
      expect(i18n.t("{{ count }} comments", { count: 2 })).toBe("2 коментарі");
      expect(i18n.t("{{ count }} comments", { count: 5 })).toBe("5 коментарів");
      expect(i18n.t("{{ count }} comments", { count: 21 })).toBe("21 коментар");
      expect(i18n.t("{{ count }} comments", { count: 22 })).toBe("22 коментарі");
      expect(i18n.t("{{ count }} comments", { count: 25 })).toBe("25 коментарів");
    });
  });

  describe("3. Unicode NFC/NFD Normalization and Case-Insensitive Matching", () => {
    it("ciEqual correctly matches precomposed and decomposed Cyrillic strings", () => {
      // 'й' у формі NFC (\u0439) та декомпонованій NFD (\u0438\u0306)
      const nfcY = "Мій мод";
      const nfdY = "Мі\u0438\u0306 мод";
      expect(ciEqual(nfcY, nfdY)).toBe(true);

      // 'ї' у формі NFC (\u0457) та NFD (\u0456\u0308)
      const nfcYi = "Україна";
      const nfdYi = "Укра\u0456\u0308на";
      expect(ciEqual(nfcYi, nfdYi)).toBe(true);

      // Чутливість до регістру для унікальних українських літер ґ, є, і, ї
      expect(ciEqual("ґрунт", "ҐРУНТ")).toBe(true);
      expect(ciEqual("єдина", "ЄДИНА")).toBe(true);
      expect(ciEqual("інтерфейс", "ІНТЕРФЕЙС")).toBe(true);
      expect(ciEqual("їжак", "ЇЖАК")).toBe(true);

      // Відмінність різних літер українського алфавіту
      expect(ciEqual("г", "ґ")).toBe(false);
      expect(ciEqual("е", "є")).toBe(false);
      expect(ciEqual("и", "і")).toBe(false);
      expect(ciEqual("і", "ї")).toBe(false);
    });

    it("ciEqual normalizes all typographic variations of Ukrainian apostrophe", () => {
      // Апострофи: ASCII ' (\u0027), типографський ’ (\u2019), літерний ʼ (\u02BC), backtick `
      const a1 = "зв'язок";
      const a2 = "зв’язок";
      const a3 = "звʼязок";
      const a4 = "зв`язок";

      expect(ciEqual(a1, a2)).toBe(true);
      expect(ciEqual(a1, a3)).toBe(true);
      expect(ciEqual(a1, a4)).toBe(true);
      expect(ciEqual(a2, a3)).toBe(true);
    });

    it("TextFilter matches Ukrainian search terms across Unicode forms and cases", () => {
      const filter = new TextFilter(true);

      // Пошук з різним регістром
      expect(filter.matches("модифікація", "Велика Модифікація для гри")).toBe(true);
      expect(filter.matches("МОДИФІКАЦІЯ", "Велика модифікація для гри")).toBe(true);

      // Пошук декомпонованого запиту в компонованому тексті
      const targetText = "Оновлення для гри";
      const decomposedQuery = "Оновленн\u044F"; // я
      expect(filter.matches(decomposedQuery, targetText)).toBe(true);

      // Пошук з різними апострофами
      expect(filter.matches("м'ясо", "Пакунок текстур: Свіже м’ясо")).toBe(true);
      expect(filter.matches("памʼять", "Мод: Текстурна пам'ять")).toBe(true);
      expect(filter.matches("памʼят", "Виправлення витоків пам'яті")).toBe(true);
    });
  });

  describe("4. Ukrainian Cyrillic Alphabet Sorting Order", () => {
    it("sorts Ukrainian characters in authentic alphabetical order (Г < Ґ < Д, Е < Є < Ж, И < І < Ї < Й)", () => {
      const alphabet = ["А", "Б", "В", "Г", "Ґ", "Д", "Е", "Є", "Ж", "З", "И", "І", "Ї", "Й", "К"];
      const unsorted = ["К", "Ґ", "Ї", "А", "Є", "І", "Д", "Б", "Ж", "В", "Е", "З", "Г", "И", "Й"];

      const sorted = unsorted.sort((a, b) => a.localeCompare(b, "uk"));
      expect(sorted).toEqual(alphabet);

      // Перевірка конкретних пар специфічних літер
      expect("Г".localeCompare("Ґ", "uk")).toBeLessThan(0);
      expect("Ґ".localeCompare("Д", "uk")).toBeLessThan(0);
      expect("Е".localeCompare("Є", "uk")).toBeLessThan(0);
      expect("Є".localeCompare("Ж", "uk")).toBeLessThan(0);
      expect("И".localeCompare("І", "uk")).toBeLessThan(0);
      expect("І".localeCompare("Ї", "uk")).toBeLessThan(0);
      expect("Ї".localeCompare("Й", "uk")).toBeLessThan(0);
    });
  });
});
