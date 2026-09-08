import * as fs from "node:fs";
import * as path from "node:path";

import type { BackendModule, i18n, PostProcessorModule, Services, TFunction } from "i18next";
import { createInstance } from "i18next";
import FSBackend from "i18next-fs-backend";
import { initReactI18next } from "react-i18next";

import type { IExtension } from "../../types/extensions";
import getVortexPath from "../getVortexPath";
import { DEFAULT_LOCALE } from "./localePolicy";
import type {
  ILocalizationAdapter,
  ILocalizationAdapterInitializationOptions,
  ILocalizationAdapterInitializationResult,
  ILocalizationRuntime,
  LocalizationTranslator,
} from "./LocalizationAdapter";

type BackendType = "bundled" | "custom" | "extension";

type BackendOptions = {
  bundled: string;
  user: string;
  translationExts: () => IExtension[];
};

class MultiBackend implements BackendModule<BackendOptions> {
  #backendOptions: BackendOptions;
  #backendType: BackendType;
  #currentBackend: FSBackend;
  #lastReadLanguage: string;
  #services: Services;

  static type = "backend" as const;
  type: "backend" = "backend" as const;

  constructor(services: Services, backendOptions: BackendOptions) {
    this.init(services, backendOptions, {});
  }

  init: BackendModule<BackendOptions>["init"] = (services, backendOptions) => {
    this.#backendOptions = backendOptions;
    this.#services = services;
  };

  read: BackendModule["read"] = (language, namespace, callback) => {
    const { backendType, extPath } = this.#getBackendType(language);
    if (
      backendType !== this.#backendType ||
      (backendType === "extension" && language !== this.#lastReadLanguage)
    ) {
      this.#currentBackend = this.initBackend(backendType, extPath);
    }
    this.#lastReadLanguage = language;
    this.#currentBackend.read(language, namespace, callback);
  };

  private initBackend(type: BackendType, extPath: string) {
    const result = new FSBackend();
    const basePath =
      type === "bundled"
        ? this.#backendOptions.bundled
        : type === "custom"
          ? this.#backendOptions.user
          : extPath;

    result.init(this.#services, {
      loadPath: path.join(basePath, "{{lng}}", "{{ns}}.json"),
      ident: 2,
    });
    this.#backendType = type;
    return result;
  }

  #getBackendType(language: string): { backendType: BackendType; extPath?: string } {
    try {
      fs.statSync(path.join(this.#backendOptions.user, language));
      return { backendType: "custom" };
    } catch {
      const extension = this.#backendOptions.translationExts().find((item) => {
        try {
          fs.statSync(path.join(item.path, language));
          return true;
        } catch {
          return false;
        }
      });

      if (extension !== undefined) {
        return { backendType: "extension", extPath: extension.path };
      }

      try {
        fs.statSync(path.join(this.#backendOptions.bundled, language));
        return { backendType: "bundled" };
      } catch {
        return { backendType: "custom" };
      }
    }
  }
}

class HighlightPostProcessor implements PostProcessorModule {
  name = "HighlightPP";

  static type = "postProcessor" as const;
  type: "postProcessor" = "postProcessor" as const;

  process: PostProcessorModule["process"] = (value, key) => {
    if (value.startsWith("TT:")) {
      console.trace("duplicate translation", key, value);
    }
    return `TT:${value.toUpperCase()}`;
  };
}

export class I18nextAdapter implements ILocalizationAdapter {
  private mInstance: i18n = createInstance();

  public get runtime(): ILocalizationRuntime {
    return this.mInstance as unknown as ILocalizationRuntime;
  }

  public get language(): string {
    return this.mInstance.language ?? DEFAULT_LOCALE;
  }

  public async initialize(
    options: ILocalizationAdapterInitializationOptions,
  ): Promise<ILocalizationAdapterInitializationResult> {
    this.reset();
    if (process.env.HIGHLIGHT_I18N === "true") {
      this.mInstance.use(new HighlightPostProcessor());
    }
    this.mInstance.use(MultiBackend).use(initReactI18next);

    const tFunc = await this.mInstance.init({
      compatibilityJSON: "v3",
      lng: options.language,
      fallbackLng: DEFAULT_LOCALE,
      fallbackNS: "common",
      ns: [
        "common",
        "collection",
        "mod_management",
        "download_management",
        "profile_management",
        "nexus_integration",
        "gamemode_management",
        "extension_manager",
        "health_check",
      ],
      defaultNS: "common",
      nsSeparator: ":::",
      keySeparator: "::",
      debug: false,
      postProcess: process.env.HIGHLIGHT_I18N === "true" ? "HighlightPP" : false,
      react: {
        // Suspense currently unmounts renderer trees without reliably running legacy cleanup.
        useSuspense: false,
      },
      saveMissing: options.debugging,
      saveMissingTo: "current",
      missingKeyHandler: (_, namespace, key) => options.onMissingKey(namespace, key),
      interpolation: { escapeValue: false },
      backend: {
        bundled: getVortexPath("locales"),
        user: path.normalize(path.join(getVortexPath("userData"), "locales")),
        translationExts: options.translationExts,
      } satisfies BackendOptions,
    });

    return {
      runtime: this.runtime,
      translator: tFunc as unknown as LocalizationTranslator,
    };
  }

  public async changeLanguage(language: string): Promise<LocalizationTranslator> {
    const translator: TFunction = await this.mInstance.changeLanguage(language);
    return translator as unknown as LocalizationTranslator;
  }

  public reset(): void {
    this.mInstance = createInstance();
  }
}
