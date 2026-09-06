import type { IPersistor } from "@vortex/shared/state";
import { describe, expect, it, vi } from "vitest";

import ConfidentialPersistor, {
  ConfidentialStorageError,
  type IConfidentialValueProtector,
} from "./ConfidentialPersistor";

function memoryPersistor(): IPersistor & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getAllKeys: () => Promise.resolve(Array.from(values.keys()).map((key) => [key])),
    getItem: (key) => Promise.resolve(values.get(key.join("."))),
    removeItem: (key) => {
      values.delete(key.join("."));
      return Promise.resolve();
    },
    setItem: (key, value) => {
      values.set(key.join("."), value);
      return Promise.resolve();
    },
    setResetCallback: vi.fn(),
  } as IPersistor & { values: Map<string, string> };
}

function protector(encryptionAvailable = true): IConfidentialValueProtector {
  return {
    decrypt: (value) => Buffer.from(value.toString(), "base64").toString(),
    encrypt: (value) => Buffer.from(Buffer.from(value).toString("base64")),
    encryptionAvailable,
  };
}

describe("ConfidentialPersistor", () => {
  it("encrypts values at rest and decrypts them on hydration", async () => {
    const wrapped = memoryPersistor();
    const persistor = new ConfidentialPersistor(wrapped, protector());

    await persistor.setItem(["account", "nexus"], '{"token":"secret"}');

    expect(wrapped.values.get("account.nexus")).not.toContain("secret");
    await expect(persistor.getItem(["account", "nexus"])).resolves.toBe('{"token":"secret"}');
  });

  it("keeps legacy plaintext credentials readable", async () => {
    const wrapped = memoryPersistor();
    wrapped.values.set("account.nexus", '{"token":"legacy"}');
    const persistor = new ConfidentialPersistor(wrapped, protector());

    await expect(persistor.getItem(["account", "nexus"])).resolves.toContain("legacy");
  });

  it("persists plaintext when no desktop encryption backend is available", async () => {
    const wrapped = memoryPersistor();
    const persistor = new ConfidentialPersistor(wrapped, protector(false));

    await persistor.setItem(["account", "nexus"], '{"token":"fallback"}');

    expect(wrapped.values.get("account.nexus")).toContain("fallback");
  });

  it("reports an explicit error when stored credentials cannot be decrypted", async () => {
    const wrapped = memoryPersistor();
    wrapped.values.set("account.nexus", "vortex-safe-storage:v1:broken");
    const failing = protector();
    failing.decrypt = () => {
      throw new Error("keyring unavailable");
    };
    const persistor = new ConfidentialPersistor(wrapped, failing);

    await expect(persistor.getItem(["account", "nexus"])).rejects.toThrow(ConfidentialStorageError);
  });
});
