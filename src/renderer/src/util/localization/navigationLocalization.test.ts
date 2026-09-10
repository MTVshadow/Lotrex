import * as fs from "node:fs";
import * as path from "node:path";

import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";

import type { ILocalizationAdapter, LocalizationTranslator } from "./LocalizationAdapter";
import { LocalizationService } from "./LocalizationService";

describe("Navigation and Extension Manager Localization (Restart-free switching)", () => {
  // Завантажуємо реальні файли локалей з робочої директорії
  const localesDir = path.resolve(__dirname, "../../../../../locales");
  const enCommon = JSON.parse(fs.readFileSync(path.join(localesDir, "en", "common.json"), "utf8"));
  const ukCommon = JSON.parse(fs.readFileSync(path.join(localesDir, "uk", "common.json"), "utf8"));
  const enExt = JSON.parse(
    fs.readFileSync(path.join(localesDir, "en", "extension_manager.json"), "utf8"),
  );
  const ukExt = JSON.parse(
    fs.readFileSync(path.join(localesDir, "uk", "extension_manager.json"), "utf8"),
  );

  async function createRealI18nextInstance() {
    const i18n = createInstance();
    await i18n.init({
      compatibilityJSON: "v3",
      lng: "en",
      fallbackLng: "en",
      defaultNS: "common",
      nsSeparator: ":::",
      keySeparator: "::",
      resources: {
        en: {
          common: enCommon,
          extension_manager: enExt,
        },
        uk: {
          common: ukCommon,
          extension_manager: ukExt,
        },
      },
      interpolation: { escapeValue: false },
    });
    return i18n;
  }

  it("resolves all semantic navigation keys in English and Ukrainian", async () => {
    const i18n = await createRealI18nextInstance();

    // 1. Перевірка англійської локалізації за замовчуванням (en)
    expect(i18n.t("navigation::header::help")).toBe("Help");
    expect(i18n.t("navigation::header::help_centre")).toBe("Help centre");
    expect(i18n.t("navigation::header::view_logs")).toBe("View logs");
    expect(i18n.t("navigation::header::about")).toBe("About");
    expect(i18n.t("navigation::header::account")).toBe("Account");
    expect(i18n.t("navigation::header::view_profile")).toBe("View profile on web");
    expect(i18n.t("navigation::header::refresh_user")).toBe("Refresh user info");
    expect(i18n.t("navigation::header::logout")).toBe("Logout");
    expect(i18n.t("navigation::header::login")).toBe("Log in");
    expect(i18n.t("navigation::header::premium")).toBe("Premium");
    expect(i18n.t("navigation::header::go_premium")).toBe("Go premium");
    expect(i18n.t("navigation::header::notifications")).toBe("Notifications");

    expect(i18n.t("navigation::window::minimize")).toBe("Minimize");
    expect(i18n.t("navigation::window::maximize")).toBe("Maximize");
    expect(i18n.t("navigation::window::restore")).toBe("Restore");
    expect(i18n.t("navigation::window::close")).toBe("Close");

    expect(i18n.t("navigation::menu::all_downloads")).toBe("All downloads");
    expect(i18n.t("navigation::spine::status_paused")).toBe("paused");
    expect(i18n.t("navigation::spine::unit_mins")).toBe("mins");
    expect(i18n.t("navigation::spine::unit_mbps")).toBe("mb/s");

    expect(i18n.t("navigation::tools::play")).toBe("Play");
    expect(i18n.t("navigation::tools::running")).toBe("Running...");
    expect(i18n.t("navigation::tools::not_configured", { replace: { name: "SKSE" } })).toBe(
      "SKSE (Not configured)",
    );

    expect(i18n.t("navigation::profile::switching", { replace: { name: "Skyrim" } })).toBe(
      "Switching to Profile: Skyrim",
    );
    expect(i18n.t("navigation::profile::none")).toBe("None");

    expect(
      i18n.t("extension_manager:::notifications::failed_already_installed", {
        replace: { name: "sample-ext" },
      }),
    ).toContain('The extension "sample-ext" is already installed but failed to load');

    // 2. Безперезавантажувальне перемикання на українську (en -> uk)
    await i18n.changeLanguage("uk");

    expect(i18n.t("navigation::header::help")).toBe("Довідка");
    expect(i18n.t("navigation::header::help_centre")).toBe("Центр довідки");
    expect(i18n.t("navigation::header::view_logs")).toBe("Переглянути журнали");
    expect(i18n.t("navigation::header::about")).toBe("Про програму");
    expect(i18n.t("navigation::header::account")).toBe("Обліковий запис");
    expect(i18n.t("navigation::header::view_profile")).toBe("Переглянути профіль на сайті");
    expect(i18n.t("navigation::header::refresh_user")).toBe("Оновити дані користувача");
    expect(i18n.t("navigation::header::logout")).toBe("Вийти");
    expect(i18n.t("navigation::header::login")).toBe("Увійти");
    expect(i18n.t("navigation::header::premium")).toBe("Premium");
    expect(i18n.t("navigation::header::go_premium")).toBe("Отримати Premium");
    expect(i18n.t("navigation::header::notifications")).toBe("Сповіщення");

    expect(i18n.t("navigation::window::minimize")).toBe("Згорнути");
    expect(i18n.t("navigation::window::maximize")).toBe("Розгорнути");
    expect(i18n.t("navigation::window::restore")).toBe("Відновити");
    expect(i18n.t("navigation::window::close")).toBe("Закрити");

    expect(i18n.t("navigation::menu::all_downloads")).toBe("Усі завантаження");
    expect(i18n.t("navigation::spine::status_paused")).toBe("пауза");
    expect(i18n.t("navigation::spine::unit_mins")).toBe("хв");
    expect(i18n.t("navigation::spine::unit_mbps")).toBe("мб/с");

    expect(i18n.t("navigation::tools::play")).toBe("Грати");
    expect(i18n.t("navigation::tools::running")).toBe("Запуск...");
    expect(i18n.t("navigation::tools::not_configured", { replace: { name: "SKSE" } })).toBe(
      "SKSE (Не налаштовано)",
    );

    expect(i18n.t("navigation::profile::switching", { replace: { name: "Skyrim" } })).toBe(
      "Перемикання на профіль: Skyrim",
    );
    expect(i18n.t("navigation::profile::none")).toBe("Немає");

    expect(
      i18n.t("extension_manager:::notifications::failed_already_installed", {
        replace: { name: "sample-ext" },
      }),
    ).toContain('Розширення "sample-ext" уже встановлено, але не вдалося завантажити');

    // 3. Зворотне безперезавантажувальне перемикання (uk -> en)
    await i18n.changeLanguage("en");
    expect(i18n.t("navigation::header::help")).toBe("Help");
    expect(i18n.t("navigation::tools::play")).toBe("Play");
    expect(i18n.t("navigation::window::minimize")).toBe("Minimize");
  });

  it("verifies LocalizationService coordinates atomic live updates for navigation without restarts", async () => {
    const i18n = await createRealI18nextInstance();

    // Створюємо адаптер, підключений до екземпляра i18next
    const adapter: ILocalizationAdapter = {
      runtime: i18n as any,
      get language() {
        return i18n.language;
      },
      initialize: async () => ({
        runtime: i18n as any,
        translator: ((key: string, opts?: any) => i18n.t(key, opts)) as LocalizationTranslator,
      }),
      changeLanguage: async (lang: string) => {
        await i18n.changeLanguage(lang);
        return ((key: string, opts?: any) => i18n.t(key, opts)) as LocalizationTranslator;
      },
      reset: async () => {
        await i18n.changeLanguage("en");
      },
    };

    const service = new LocalizationService(adapter);
    await service.initialize("en", () => []);

    // Початковий стан: English
    expect(service.currentLanguage).toBe("en");
    expect(service.translate("navigation::tools::play")).toBe("Play");
    expect(service.translate("navigation::header::help")).toBe("Help");

    // Перемикання на Ukrainian наживо
    const ukT = await service.changeLanguage("uk");
    expect(service.currentLanguage).toBe("uk");
    expect(service.translate("navigation::tools::play")).toBe("Грати");
    expect(service.translate("navigation::header::help")).toBe("Довідка");
    expect(ukT("navigation::window::close")).toBe("Закрити");

    // Зворотне перемикання на English наживо
    const enT = await service.changeLanguage("en");
    expect(service.currentLanguage).toBe("en");
    expect(service.translate("navigation::tools::play")).toBe("Play");
    expect(service.translate("navigation::header::help")).toBe("Help");
    expect(enT("navigation::window::close")).toBe("Close");
  });
});
