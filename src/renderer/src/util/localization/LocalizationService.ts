import type { IExtension } from "../../types/extensions";
import { I18nextAdapter } from "./I18nextAdapter";
import { DEFAULT_LOCALE, normalizeLocale } from "./localePolicy";
import type {
  ILocalizationAdapter,
  ILocalizationRuntime,
  LocalizationOptions,
  LocalizationTranslator,
} from "./LocalizationAdapter";

export const fallbackTFunc: LocalizationTranslator = (key: string | string[]) =>
  String(Array.isArray(key) ? key[0] : key);

export interface ILocalizationInitializationResult {
  runtime: ILocalizationRuntime;
  translator: LocalizationTranslator;
  error?: unknown;
}

export class LocalizationService {
  private mActualT: LocalizationTranslator = fallbackTFunc;
  private readonly mAdapter: ILocalizationAdapter;
  private mCurrentLanguage = DEFAULT_LOCALE;
  private mDebugging = false;
  private mMissingKeys: Record<string, Record<string, string>> = { common: {} };
  private mSwitchQueue: Promise<void> = Promise.resolve();
  private mTranslationExts: () => IExtension[] = () => [];

  constructor(adapter: ILocalizationAdapter = new I18nextAdapter()) {
    this.mAdapter = adapter;
  }

  public async initialize(
    language: string,
    translationExts: () => IExtension[],
  ): Promise<ILocalizationInitializationResult> {
    const normalizedLanguage = normalizeLocale(language);
    this.mCurrentLanguage = normalizedLanguage;
    this.mTranslationExts = translationExts;

    try {
      const result = await this.mAdapter.initialize({
        debugging: this.mDebugging,
        language: normalizedLanguage,
        onMissingKey: (namespace, key) => this.recordMissingKey(namespace, key),
        translationExts,
      });
      this.mActualT = result.translator;
      this.syncDocumentLanguage(normalizedLanguage);
      return result;
    } catch (error) {
      this.mActualT = fallbackTFunc;
      this.syncDocumentLanguage(normalizedLanguage);
      return { runtime: this.mAdapter.runtime, translator: fallbackTFunc, error };
    }
  }

  public get currentLanguage(): string {
    return this.mCurrentLanguage;
  }

  public changeLanguage(
    language: string,
    callback?: (error: Error) => void,
  ): Promise<LocalizationTranslator> {
    const normalizedLanguage = normalizeLocale(language);
    const operation = this.mSwitchQueue.then(() =>
      this.performLanguageChange(normalizedLanguage, callback),
    );
    this.mSwitchQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  public translate(key: string | string[], options?: LocalizationOptions): string {
    return this.mActualT(key, options);
  }

  public reset(): Promise<void> {
    const operation = this.mSwitchQueue.then(async () => {
      await this.mAdapter.reset();
      this.mActualT = fallbackTFunc;
      this.mCurrentLanguage = DEFAULT_LOCALE;
      this.mDebugging = false;
      this.mMissingKeys = { common: {} };
      this.mTranslationExts = () => [];
      this.syncDocumentLanguage(DEFAULT_LOCALE);
    });
    this.mSwitchQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  public setDebugging(enable?: boolean): void {
    this.mDebugging = enable ?? !this.mDebugging;
    this.mMissingKeys = { common: {} };
    this.initialize(this.mAdapter.language, this.mTranslationExts).catch(() => {});
  }

  public get missingTranslations(): Record<string, Record<string, string>> {
    return this.mMissingKeys;
  }

  private recordMissingKey(namespace: string, key: string): void {
    this.mMissingKeys[namespace] ??= {};
    this.mMissingKeys[namespace][key] = key;
  }

  private async performLanguageChange(
    language: string,
    callback?: (error: Error) => void,
  ): Promise<LocalizationTranslator> {
    const previousLanguage = this.mCurrentLanguage;
    try {
      const tFunc = await this.mAdapter.changeLanguage(language);
      this.mActualT = tFunc;
      this.mCurrentLanguage = language;
      this.syncDocumentLanguage(language);
      callback?.(undefined);
      return tFunc;
    } catch (error) {
      const switchError =
        error instanceof Error
          ? error
          : new Error("Localization adapter failed to change language", { cause: error });
      try {
        await this.mAdapter.changeLanguage(previousLanguage);
        this.syncDocumentLanguage(previousLanguage);
      } catch {
        // Keep the last committed service state even if the adapter cannot reload it.
      }
      callback?.(switchError);
      throw error;
    }
  }

  /**
   * Synchronizes the HTML document lang attribute with the active application locale.
   *
   * Educational comment:
   * Setting <html lang="..."> is a WCAG 2.1 Level A requirement (Criterion 3.1.1).
   * It allows Linux screen readers (e.g. Orca / speech-dispatcher) and assistive technologies
   * to load the correct phonetic dictionary and pronunciation engine for Ukrainian text.
   */
  private syncDocumentLanguage(language: string): void {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = language;
      document.documentElement.dir = "ltr";
    }
  }
}

export const localizationService = new LocalizationService();
