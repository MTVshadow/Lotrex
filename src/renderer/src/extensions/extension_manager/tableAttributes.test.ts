import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import type { IExtensionWithState } from "../../types/extensions";
import getTableAttributes from "./tableAttributes";

describe("tableAttributes localization", () => {
  // Навчальний тест: перевірка динамічної локалізації колонок менеджера розширень
  const mockT = ((key: string, _options?: any) => {
    const dictionary: Record<string, string> = {
      "extension_manager:::table::status::name": "Стан",
      "extension_manager:::table::status::description": "Чи увімкнено розширення",
      "extension_manager:::table::status::enabled": "Увімкнено",
      "extension_manager:::table::status::disabled": "Вимкнено",
      "extension_manager:::table::status::failed": "Помилка",
      "extension_manager:::table::name::name": "Назва",
      "extension_manager:::table::errors::name": "Помилки завантаження",
      "extension_manager:::table::errors::not_compatible": "Несумісно з цією версією Lotrex",
    };
    return dictionary[key] ?? key;
  }) as unknown as TFunction;

  const context = {
    onSetExtensionEnabled: vi.fn(),
    onToggleExtensionEnabled: vi.fn(),
    onEndorseMod: vi.fn(),
  };

  it("applies semantic translations to table columns and status choices", () => {
    const columns = getTableAttributes(context, mockT);

    const statusCol = columns.find((c) => c.id === "enabled");
    expect(statusCol).toBeDefined();
    expect(statusCol?.name).toBe("Стан");
    expect(statusCol?.description).toBe("Чи увімкнено розширення");

    const choices = (statusCol?.edit as any)?.choices();
    expect(choices).toEqual([
      { key: "enabled", text: "Увімкнено" },
      { key: "disabled", text: "Вимкнено" },
      { key: "failed", text: "Помилка", visible: false },
    ]);

    const enabledExt = { name: "test-ext", enabled: true } as IExtensionWithState;
    expect(statusCol?.calc(enabledExt, mockT)).toBe("Увімкнено");

    const disabledExt = { name: "test-ext", enabled: false } as IExtensionWithState;
    expect(statusCol?.calc(disabledExt, mockT)).toBe("Вимкнено");

    const failedExt = { name: "test-ext", enabled: "failed" } as IExtensionWithState;
    expect(statusCol?.calc(failedExt, mockT)).toBe("Помилка");
  });

  it("translates load failures in errors column", () => {
    const columns = getTableAttributes(context, mockT);
    const errorsCol = columns.find((c) => c.id === "errors");
    expect(errorsCol?.name).toBe("Помилки завантаження");

    const extWithErrors = {
      name: "faulty-ext",
      loadFailures: [{ id: "unsupported-version" }],
    } as unknown as IExtensionWithState;

    expect(errorsCol?.calc(extWithErrors, mockT)).toBe("Несумісно з цією версією Lotrex");
  });
});
