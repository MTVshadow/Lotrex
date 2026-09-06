import type { IPersistor, PersistorKey } from "@vortex/shared/state";

const ENCRYPTED_PREFIX = "vortex-safe-storage:v1:";

export interface IConfidentialValueProtector {
  decrypt(value: Buffer): string;
  encrypt(value: string): Buffer;
  encryptionAvailable: boolean;
}

export class ConfidentialStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfidentialStorageError";
  }
}

export default class ConfidentialPersistor implements IPersistor {
  public getAllKVs: (() => PromiseLike<Array<{ key: PersistorKey; value: string }>>) | undefined;
  public bulkSetItem:
    | ((items: ReadonlyArray<{ key: PersistorKey; value: string }>) => PromiseLike<void>)
    | undefined;
  public bulkRemoveItem: ((keys: ReadonlyArray<PersistorKey>) => PromiseLike<void>) | undefined;

  constructor(
    private readonly wrapped: IPersistor,
    private readonly protector: IConfidentialValueProtector,
  ) {
    const getAllKVs = wrapped.getAllKVs?.bind(wrapped);
    this.getAllKVs = getAllKVs
      ? () =>
          getAllKVs().then((items) =>
            items.map((item) => ({ ...item, value: this.decode(item.value) })),
          )
      : undefined;
    this.bulkSetItem = wrapped.bulkSetItem
      ? (items) =>
          wrapped.bulkSetItem?.(
            items.map((item) => ({ ...item, value: this.encode(item.value) })),
          ) ?? Promise.resolve()
      : undefined;
    this.bulkRemoveItem = wrapped.bulkRemoveItem?.bind(wrapped);
  }

  public setResetCallback(callback: () => PromiseLike<void>): void {
    this.wrapped.setResetCallback(callback);
  }

  public getItem(key: PersistorKey): PromiseLike<string> {
    return this.wrapped.getItem(key).then((value) => this.decode(value));
  }

  public setItem(key: PersistorKey, value: string): PromiseLike<void> {
    return this.wrapped.setItem(key, this.encode(value));
  }

  public removeItem(key: PersistorKey): PromiseLike<void> {
    return this.wrapped.removeItem(key);
  }

  public getAllKeys(): PromiseLike<PersistorKey[]> {
    return this.wrapped.getAllKeys();
  }

  private encode(value: string): string {
    if (!this.protector.encryptionAvailable) {
      return value;
    }
    try {
      return ENCRYPTED_PREFIX + this.protector.encrypt(value).toString("base64");
    } catch (error) {
      throw new ConfidentialStorageError("Failed to encrypt confidential application state", {
        cause: error,
      });
    }
  }

  private decode(value: string): string {
    if (!value.startsWith(ENCRYPTED_PREFIX)) {
      return value;
    }
    try {
      const encrypted = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64");
      return this.protector.decrypt(encrypted);
    } catch (error) {
      throw new ConfidentialStorageError(
        "Stored credentials could not be decrypted. The desktop keyring may have changed or be unavailable.",
        { cause: error },
      );
    }
  }
}
