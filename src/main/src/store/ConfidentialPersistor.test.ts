import type { IPersistor, PersistorKey } from "@vortex/shared/state";
import { describe, expect, it, vi } from "vitest";

import ConfidentialPersistor, {
  ConfidentialStorageError,
  type IConfidentialValueProtector,
} from "./ConfidentialPersistor";

function memoryPersistor(): IPersistor & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getAllKeys: () => Promise.resolve(Array.from(values.keys()).map((key) => key.split("."))),
    getAllKVs: () =>
      Promise.resolve(
        Array.from(values.entries()).map(([key, value]) => ({
          key: key.split("."),
          value,
        })),
      ),
    getItem: (key: PersistorKey) => Promise.resolve(values.get(key.join("."))),
    removeItem: (key: PersistorKey) => {
      values.delete(key.join("."));
      return Promise.resolve();
    },
    setItem: (key: PersistorKey, value: string) => {
      values.set(key.join("."), value);
      return Promise.resolve();
    },
    bulkSetItem: (items: ReadonlyArray<{ key: PersistorKey; value: string }>) => {
      for (const item of items) {
        values.set(item.key.join("."), item.value);
      }
      return Promise.resolve();
    },
    setResetCallback: vi.fn(),
  } as unknown as IPersistor & { values: Map<string, string> };
}

function protector(encryptionAvailable = true): IConfidentialValueProtector {
  return {
    decrypt: (value) => Buffer.from(value.toString(), "base64").toString(),
    encrypt: (value) => Buffer.from(Buffer.from(value).toString("base64")),
    encryptionAvailable,
  };
}

describe("ConfidentialPersistor — Secret Service & Keyring Matrix", () => {
  describe("1. Unlocked state (Secret Service active and available)", () => {
    it("encrypts values at rest and decrypts them on hydration", async () => {
      const wrapped = memoryPersistor();
      const persistor = new ConfidentialPersistor(wrapped, protector(true));

      await persistor.setItem(["account", "nexus"], '{"token":"secret_nexus_key"}');

      const raw = wrapped.values.get("account.nexus");
      expect(raw).toBeDefined();
      expect(raw).toMatch(/^vortex-safe-storage:v1:/);
      expect(raw).not.toContain("secret_nexus_key");

      await expect(persistor.getItem(["account", "nexus"])).resolves.toBe(
        '{"token":"secret_nexus_key"}',
      );
    });

    it("handles bulk operations seamlessly with encryption and decryption", async () => {
      const wrapped = memoryPersistor();
      const persistor = new ConfidentialPersistor(wrapped, protector(true));

      await persistor.bulkSetItem!([
        { key: ["auth", "token"], value: "bearer_xyz" },
        { key: ["auth", "refresh"], value: "refresh_abc" },
      ]);

      expect(wrapped.values.get("auth.token")).toMatch(/^vortex-safe-storage:v1:/);
      expect(wrapped.values.get("auth.refresh")).toMatch(/^vortex-safe-storage:v1:/);

      const kvs = await persistor.getAllKVs!();
      expect(kvs).toEqual([
        { key: ["auth", "token"], value: "bearer_xyz" },
        { key: ["auth", "refresh"], value: "refresh_abc" },
      ]);
    });

    it("keeps legacy plaintext credentials readable", async () => {
      const wrapped = memoryPersistor();
      wrapped.values.set("account.nexus", '{"token":"legacy"}');
      const persistor = new ConfidentialPersistor(wrapped, protector(true));

      await expect(persistor.getItem(["account", "nexus"])).resolves.toBe('{"token":"legacy"}');
    });
  });

  describe("2. Locked state (Master password required or prompt cancelled)", () => {
    it("throws ConfidentialStorageError on decryption failure and preserves stored ciphertext", async () => {
      const wrapped = memoryPersistor();
      const encryptedValue = "vortex-safe-storage:v1:encrypted_payload_data";
      wrapped.values.set("account.nexus", encryptedValue);

      const lockedProtector = protector(true);
      lockedProtector.decrypt = () => {
        throw new Error("Secret Service prompt cancelled or keyring locked");
      };

      const persistor = new ConfidentialPersistor(wrapped, lockedProtector);

      await expect(persistor.getItem(["account", "nexus"])).rejects.toThrow(
        ConfidentialStorageError,
      );

      // Verify stored ciphertext is NEVER deleted or corrupted when locked
      expect(wrapped.values.get("account.nexus")).toBe(encryptedValue);
    });

    it("throws ConfidentialStorageError when encryption fails during locked state without corrupting storage", async () => {
      const wrapped = memoryPersistor();
      const lockedProtector = protector(true);
      lockedProtector.encrypt = () => {
        throw new Error("Keyring locked: cannot encrypt");
      };

      const persistor = new ConfidentialPersistor(wrapped, lockedProtector);

      await expect(
        persistor.setItem(["account", "nexus"], '{"token":"new_secret"}'),
      ).rejects.toThrow(ConfidentialStorageError);

      expect(wrapped.values.has("account.nexus")).toBe(false);
    });

    it("rejects bulkSetItem cleanly if any value cannot be encrypted", async () => {
      const wrapped = memoryPersistor();
      const lockedProtector = protector(true);
      lockedProtector.encrypt = () => {
        throw new Error("Keyring locked");
      };

      const persistor = new ConfidentialPersistor(wrapped, lockedProtector);

      await expect(
        persistor.bulkSetItem!([{ key: ["auth", "token"], value: "test" }]),
      ).rejects.toThrow(ConfidentialStorageError);
    });
  });

  describe("3. Absent / Headless fallback state (encryption unavailable or basic_text)", () => {
    it("persists and reads plaintext when no desktop encryption backend is available", async () => {
      const wrapped = memoryPersistor();
      const persistor = new ConfidentialPersistor(wrapped, protector(false));

      await persistor.setItem(["account", "nexus"], '{"token":"headless_token"}');

      const raw = wrapped.values.get("account.nexus");
      expect(raw).toBe('{"token":"headless_token"}');
      expect(raw).not.toMatch(/^vortex-safe-storage:v1:/);

      await expect(persistor.getItem(["account", "nexus"])).resolves.toBe(
        '{"token":"headless_token"}',
      );
    });

    it("handles bulkSetItem and getAllKVs cleanly in headless absent state", async () => {
      const wrapped = memoryPersistor();
      const persistor = new ConfidentialPersistor(wrapped, protector(false));

      await persistor.bulkSetItem!([
        { key: ["auth", "id"], value: "user123" },
        { key: ["auth", "key"], value: "headless_api_key" },
      ]);

      expect(wrapped.values.get("auth.id")).toBe("user123");
      expect(wrapped.values.get("auth.key")).toBe("headless_api_key");

      const kvs = await persistor.getAllKVs!();
      expect(kvs).toEqual([
        { key: ["auth", "id"], value: "user123" },
        { key: ["auth", "key"], value: "headless_api_key" },
      ]);
    });

    it("reports an explicit error when stored credentials cannot be decrypted in absent state", async () => {
      const wrapped = memoryPersistor();
      wrapped.values.set("account.nexus", "vortex-safe-storage:v1:broken");
      const failing = protector(false);
      failing.decrypt = () => {
        throw new Error("no desktop keyring backend available");
      };
      const persistor = new ConfidentialPersistor(wrapped, failing);

      await expect(persistor.getItem(["account", "nexus"])).rejects.toThrow(
        ConfidentialStorageError,
      );
    });
  });
});
