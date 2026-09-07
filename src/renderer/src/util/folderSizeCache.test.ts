import { describe, expect, it, vi } from "vitest";

vi.mock("./calculateFolderSize", () => ({ default: vi.fn() }));
vi.mock("./fs", () => ({ statAsync: vi.fn() }));

import { FolderSizeCache } from "./folderSizeCache";

const fingerprint = (mtimeMs = 1) => ({ ctimeMs: mtimeMs, dev: 1, ino: 2, mtimeMs });

describe("FolderSizeCache", () => {
  it("reuses a size while the root fingerprint is unchanged", async () => {
    const calculate = vi.fn().mockResolvedValue(42);
    const cache = new FolderSizeCache(calculate, vi.fn().mockResolvedValue(fingerprint()));

    await expect(cache.get("/staging/mod")).resolves.toBe(42);
    await expect(cache.get("/staging/mod")).resolves.toBe(42);
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it("recalculates after installation root metadata changes", async () => {
    const calculate = vi.fn().mockResolvedValueOnce(42).mockResolvedValueOnce(84);
    const readFingerprint = vi
      .fn()
      .mockResolvedValueOnce(fingerprint(1))
      .mockResolvedValueOnce(fingerprint(2));
    const cache = new FolderSizeCache(calculate, readFingerprint);

    await expect(cache.get("/staging/mod")).resolves.toBe(42);
    await expect(cache.get("/staging/mod")).resolves.toBe(84);
  });

  it("deduplicates concurrent scans", async () => {
    let resolveSize: (value: number) => void;
    const calculate = vi.fn(() => new Promise<number>((resolve) => (resolveSize = resolve)));
    const cache = new FolderSizeCache(calculate, vi.fn().mockResolvedValue(fingerprint()));

    const first = cache.get("/staging/mod");
    const second = cache.get("/staging/mod");
    await vi.waitFor(() => expect(calculate).toHaveBeenCalledTimes(1));
    resolveSize!(64);
    await expect(Promise.all([first, second])).resolves.toEqual([64, 64]);
  });

  it("invalidates one subtree without flushing unrelated entries", async () => {
    const calculate = vi.fn().mockResolvedValue(10);
    const cache = new FolderSizeCache(calculate, vi.fn().mockResolvedValue(fingerprint()));
    await Promise.all([cache.get("/staging/a/mod"), cache.get("/staging/b/mod")]);

    cache.invalidate("/staging/a");
    await Promise.all([cache.get("/staging/a/mod"), cache.get("/staging/b/mod")]);
    expect(calculate).toHaveBeenCalledTimes(3);
  });

  it("does not retain rejected scans", async () => {
    const calculate = vi
      .fn()
      .mockRejectedValueOnce(new Error("scan failed"))
      .mockResolvedValueOnce(12);
    const cache = new FolderSizeCache(calculate, vi.fn().mockResolvedValue(fingerprint()));

    await expect(cache.get("/staging/mod")).rejects.toThrow("scan failed");
    await expect(cache.get("/staging/mod")).resolves.toBe(12);
  });
});
