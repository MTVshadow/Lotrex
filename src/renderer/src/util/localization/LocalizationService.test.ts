import { describe, expect, it, vi } from "vitest";

import type {
  ILocalizationAdapter,
  ILocalizationAdapterInitializationOptions,
  ILocalizationRuntime,
  LocalizationTranslator,
} from "./LocalizationAdapter";
import { fallbackTFunc, LocalizationService } from "./LocalizationService";

function createAdapter() {
  const runtime = {} as ILocalizationRuntime;
  const translator: LocalizationTranslator = (key) => `translated:${key}`;
  let language = "en";
  const initialize = vi.fn(async (_options: ILocalizationAdapterInitializationOptions) => ({
    runtime,
    translator,
  }));
  const changeLanguage = vi.fn(async (nextLanguage: string) => {
    language = nextLanguage;
    return translator;
  });
  const reset = vi.fn(() => {
    language = "en";
  });
  const adapter: ILocalizationAdapter = {
    runtime,
    get language() {
      return language;
    },
    changeLanguage,
    initialize,
    reset,
  };
  return { adapter, changeLanguage, initialize, reset, runtime, translator };
}

describe("LocalizationService", () => {
  it("normalizes initialization and delegates it to the adapter", async () => {
    const { adapter, initialize } = createAdapter();
    const service = new LocalizationService(adapter);
    const translationExts = () => [];

    const result = await service.initialize("not_a_locale", translationExts);

    expect(service.currentLanguage).toBe("en");
    expect(result.translator("key")).toBe("translated:key");
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en", translationExts }),
    );
  });

  it("normalizes runtime changes before delegating", async () => {
    const { adapter, changeLanguage } = createAdapter();
    const service = new LocalizationService(adapter);

    await service.changeLanguage("ru-RU");

    expect(service.currentLanguage).toBe("en");
    expect(changeLanguage).toHaveBeenCalledWith("en");
  });

  it("records missing keys reported by the adapter", async () => {
    const { adapter, initialize } = createAdapter();
    const service = new LocalizationService(adapter);
    await service.initialize("uk", () => []);
    const options = initialize.mock.calls[0][0];

    options.onMissingKey("settings", "downloads.install_automatically");

    expect(service.missingTranslations).toEqual({
      common: {},
      settings: {
        "downloads.install_automatically": "downloads.install_automatically",
      },
    });
  });

  it("returns the fallback translator when adapter initialization fails", async () => {
    const { adapter, initialize, runtime } = createAdapter();
    initialize.mockRejectedValueOnce(new Error("failed to load locale"));
    const service = new LocalizationService(adapter);

    const result = await service.initialize("uk", () => []);

    expect(result.runtime).toBe(runtime);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.translator).toBe(fallbackTFunc);
    expect(service.translate("untranslated", {})).toBe("untranslated");
  });

  it("commits the locale only after the adapter succeeds", async () => {
    const { adapter, changeLanguage } = createAdapter();
    let finishSwitch: (translator: LocalizationTranslator) => void;
    changeLanguage.mockImplementationOnce(
      () => new Promise<LocalizationTranslator>((resolve) => (finishSwitch = resolve)),
    );
    const service = new LocalizationService(adapter);

    const switching = service.changeLanguage("uk");
    await Promise.resolve();
    expect(service.currentLanguage).toBe("en");

    finishSwitch(fallbackTFunc);
    await switching;
    expect(service.currentLanguage).toBe("uk");
  });

  it("restores the previous adapter locale when switching fails", async () => {
    const { adapter, changeLanguage } = createAdapter();
    const failure = new Error("locale load failed");
    changeLanguage.mockRejectedValueOnce(failure);
    const callback = vi.fn();
    const service = new LocalizationService(adapter);

    await expect(service.changeLanguage("uk", callback)).rejects.toBe(failure);

    expect(service.currentLanguage).toBe("en");
    expect(changeLanguage).toHaveBeenNthCalledWith(1, "uk");
    expect(changeLanguage).toHaveBeenNthCalledWith(2, "en");
    expect(callback).toHaveBeenCalledWith(failure);
  });

  it("resets only after an active locale switch finishes", async () => {
    const { adapter, changeLanguage, initialize, reset } = createAdapter();
    let finishSwitch: (translator: LocalizationTranslator) => void;
    changeLanguage.mockImplementationOnce(
      () => new Promise<LocalizationTranslator>((resolve) => (finishSwitch = resolve)),
    );
    const service = new LocalizationService(adapter);
    await service.initialize("uk", () => []);
    initialize.mock.calls[0][0].onMissingKey("settings", "missing");

    const switching = service.changeLanguage("en");
    const resetting = service.reset();
    await Promise.resolve();
    expect(reset).not.toHaveBeenCalled();

    finishSwitch(fallbackTFunc);
    await switching;
    await resetting;

    expect(reset).toHaveBeenCalledOnce();
    expect(service.currentLanguage).toBe("en");
    expect(service.translate("untranslated")).toBe("untranslated");
    expect(service.missingTranslations).toEqual({ common: {} });
  });

  it("verifies restart-free atomic bidirectional switching (en -> uk -> en) with live translator updates", async () => {
    // Верифікація атомарного безперезавантажувального перемикання:
    // перевіряємо, що перемикач оновлює внутрішній стан сервісу та функції трансляції наживо без перезапуску застосунку
    let activeLanguage = "en";
    const dynamicTranslator: LocalizationTranslator = (key) => `${activeLanguage}:${key}`;
    const runtime = {} as ILocalizationRuntime;
    const changeLanguage = vi.fn(async (nextLang: string) => {
      activeLanguage = nextLang;
      return dynamicTranslator;
    });
    const adapter: ILocalizationAdapter = {
      runtime,
      get language() {
        return activeLanguage;
      },
      initialize: vi.fn(async () => ({ runtime, translator: dynamicTranslator })),
      changeLanguage,
      reset: vi.fn(),
    };

    const service = new LocalizationService(adapter);
    await service.initialize("en", () => []);

    expect(service.currentLanguage).toBe("en");
    expect(service.translate("message")).toBe("en:message");

    // Перемикання en -> uk наживо
    const ukTranslator = await service.changeLanguage("uk");
    expect(service.currentLanguage).toBe("uk");
    expect(service.translate("message")).toBe("uk:message");
    expect(ukTranslator("message")).toBe("uk:message");
    expect(changeLanguage).toHaveBeenLastCalledWith("uk");

    // Зворотне перемикання uk -> en наживо
    const enTranslator = await service.changeLanguage("en");
    expect(service.currentLanguage).toBe("en");
    expect(service.translate("message")).toBe("en:message");
    expect(enTranslator("message")).toBe("en:message");
    expect(changeLanguage).toHaveBeenLastCalledWith("en");
    expect(changeLanguage).toHaveBeenCalledTimes(2);
  });

  it("serializes rapid sequential locale switches (en -> uk -> en -> uk) without race conditions", async () => {
    // Тестування серіалізації черги mSwitchQueue під час швидких послідовних запитів перемикання мови
    let activeLanguage = "en";
    const runtime = {} as ILocalizationRuntime;
    const changeLanguage = vi.fn(async (nextLang: string) => {
      activeLanguage = nextLang;
      const langForThisCall = nextLang;
      // Імітуємо асинхронне навантаження
      await new Promise((res) => setTimeout(res, 5));
      return ((key: string) => `${langForThisCall}:${key}`) as LocalizationTranslator;
    });
    const adapter: ILocalizationAdapter = {
      runtime,
      get language() {
        return activeLanguage;
      },
      initialize: vi.fn(async () => ({
        runtime,
        translator: (key: string) => `en:${key}`,
      })),
      changeLanguage,
      reset: vi.fn(),
    };

    const service = new LocalizationService(adapter);
    await service.initialize("en", () => []);

    // Створюємо каскад швидких запитів
    const p1 = service.changeLanguage("uk");
    const p2 = service.changeLanguage("en");
    const p3 = service.changeLanguage("uk");

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1("item")).toBe("uk:item");
    expect(r2("item")).toBe("en:item");
    expect(r3("item")).toBe("uk:item");
    expect(service.currentLanguage).toBe("uk");
    expect(service.translate("item")).toBe("uk:item");
    expect(changeLanguage).toHaveBeenCalledTimes(3);
  });

  it("recovers cleanly from invalid locale input by normalizing to allowed fallback", async () => {
    // Перевірка нормалізації невалідного коду мови до дефолтної ("en") без аварійного завершення
    const { adapter, changeLanguage } = createAdapter();
    const service = new LocalizationService(adapter);
    await service.initialize("en", () => []);

    await service.changeLanguage("invalid_lang_code");

    expect(service.currentLanguage).toBe("en");
    expect(changeLanguage).toHaveBeenCalledWith("en");
  });
});
