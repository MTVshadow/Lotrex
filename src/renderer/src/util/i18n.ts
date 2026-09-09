import type { TFunction, TOptions, i18n } from "i18next";

import type { IExtension } from "../types/extensions";
import type { LocalizationOptions } from "./localization/LocalizationAdapter";
import {
  fallbackTFunc as serviceFallbackTFunc,
  localizationService,
} from "./localization/LocalizationService";

/** @public */
export type { i18n };

/** @public */
export type { TFunction };

export const fallbackTFunc = serviceFallbackTFunc as TFunction;

/** Initialize the localization service. */
export function init(
  language: string,
  translationExts: () => IExtension[],
): Promise<{ i18n: i18n; tFunc: TFunction; error?: unknown }> {
  return localizationService.initialize(language, translationExts).then((result) => ({
    i18n: result.runtime as i18n,
    tFunc: result.translator as TFunction,
    error: result.error,
  }));
}

export function getCurrentLanguage(): string {
  return localizationService.currentLanguage;
}

/** Reset localization state before a clean reinitialization. */
export function resetLocalization(): Promise<void> {
  return localizationService.reset();
}

export function changeLanguage(
  language: string,
  callback?: (error: Error) => void,
): ReturnType<typeof localizationService.changeLanguage> {
  return localizationService.changeLanguage(language, callback);
}

export function globalT(key: string | string[], options: TOptions) {
  return localizationService.translate(key, options as LocalizationOptions);
}

export function debugTranslations(enable?: boolean): void {
  localizationService.setDebugging(enable);
}

export function getMissingTranslations(): Record<string, Record<string, string>> {
  return localizationService.missingTranslations;
}

export interface ITString {
  key: string;
  options?: TOptions;
  toString(): string;
}

export class TString implements ITString {
  private mKey: string;
  private mOptions: TOptions;

  constructor(key: string, options: TOptions, namespace: string) {
    this.mKey = key;
    this.mOptions = options ?? {};
    if (this.mOptions.ns === undefined) {
      this.mOptions.ns = namespace;
    }
  }

  public get key(): string {
    return this.mKey;
  }

  public get options(): TOptions {
    return this.mOptions;
  }

  public toString(): string {
    return this.mKey;
  }
}

export const laterT: TFunction = (
  key: string,
  optionsOrDefault?: TOptions | string,
  options?: TOptions,
): ITString => {
  if (typeof optionsOrDefault === "string") {
    return new TString(key, options, "common");
  }
  return new TString(key, optionsOrDefault, "common");
};

export function preT(
  t: TFunction,
  key: string | string[] | ITString,
  options?: TOptions,
  onlyTString?: boolean,
) {
  if ([undefined, null].includes(key)) {
    return "";
  }
  if (typeof key === "string") {
    return onlyTString === true ? key : t(key, options);
  }
  if (Array.isArray(key)) {
    return t(key, options);
  }
  return t(key.key, { ...key.options, ...(options ?? {}) });
}
