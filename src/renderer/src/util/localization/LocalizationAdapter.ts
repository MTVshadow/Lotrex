import type { IExtension } from "../../types/extensions";

export type LocalizationKey = string | string[];
export type LocalizationOptions = Record<string, unknown>;
export type LocalizationTranslator = (
  key: LocalizationKey,
  options?: LocalizationOptions,
) => string;

export interface ILocalizationRuntime {
  addResources(language: string, namespace: string, resources: Record<string, unknown>): unknown;
}

export interface ILocalizationAdapterInitializationOptions {
  debugging: boolean;
  language: string;
  onMissingKey: (namespace: string, key: string) => void;
  translationExts: () => IExtension[];
}

export interface ILocalizationAdapterInitializationResult {
  runtime: ILocalizationRuntime;
  translator: LocalizationTranslator;
}

export interface ILocalizationAdapter {
  readonly language: string;
  readonly runtime: ILocalizationRuntime;
  changeLanguage(language: string): Promise<LocalizationTranslator>;
  initialize(
    options: ILocalizationAdapterInitializationOptions,
  ): Promise<ILocalizationAdapterInitializationResult>;
  reset(): void | Promise<void>;
}
