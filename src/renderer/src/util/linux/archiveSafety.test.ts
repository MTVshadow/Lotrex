import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../fs", async () => {
  const native = await import("node:fs/promises");
  return {
    lstatAsync: native.lstat,
    readlinkAsync: native.readlink,
    statAsync: native.stat,
    readdirAsync: native.readdir,
  };
});

import {
  ArchiveSafetyTracker,
  assertArchiveSafeToExtract,
  assertArchiveDecompressionSafety,
  assertLinuxSafeExtractedTree,
  getPosixSpecialDeviceType,
  S_IFBLK,
  S_IFCHR,
  S_IFDIR,
  S_IFIFO,
  S_IFLNK,
  S_IFREG,
  S_IFSOCK,
} from "./archiveSafety";

describe("Archive adversarial corpus and decompression safety", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
    );
  });

  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-archive-safety-"));
    tempDirs.push(dir);
    return dir;
  }

  describe("getPosixSpecialDeviceType", () => {
    it("identifies special POSIX file types correctly", () => {
      expect(getPosixSpecialDeviceType(S_IFIFO | 0o644)).toBe("fifo");
      expect(getPosixSpecialDeviceType(S_IFCHR | 0o660)).toBe("character_device");
      expect(getPosixSpecialDeviceType(S_IFBLK | 0o660)).toBe("block_device");
      expect(getPosixSpecialDeviceType(S_IFSOCK | 0o777)).toBe("socket");
    });

    it("returns undefined for standard regular files, directories, and symlinks", () => {
      expect(getPosixSpecialDeviceType(S_IFREG | 0o644)).toBeUndefined();
      expect(getPosixSpecialDeviceType(S_IFDIR | 0o755)).toBeUndefined();
      expect(getPosixSpecialDeviceType(S_IFLNK | 0o777)).toBeUndefined();
    });
  });

  describe("assertArchiveDecompressionSafety", () => {
    it("allows standard benign archives within ratio and size limits", () => {
      expect(() =>
        assertArchiveDecompressionSafety({
          compressedSizeBytes: 50 * 1024 * 1024, // 50 MiB
          uncompressedSizeBytes: 120 * 1024 * 1024, // 120 MiB (~2.4:1 ratio)
          fileCount: 350,
        }),
      ).not.toThrow();
    });

    it("allows small repetitive files with high ratios below the minimum threshold", () => {
      // 100 bytes compressed expanding to 20 KiB is a 200:1 ratio, but 20 KiB < 50 MiB threshold
      expect(() =>
        assertArchiveDecompressionSafety({
          compressedSizeBytes: 100,
          uncompressedSizeBytes: 20 * 1024,
          fileCount: 1,
        }),
      ).not.toThrow();
    });

    it("rejects decompression bomb exceeding maximum compression ratio above threshold", () => {
      // 100 KiB expanding to 60 MiB is a 600:1 ratio, well above the 250:1 limit and >= 50 MiB threshold
      expect(() =>
        assertArchiveDecompressionSafety({
          compressedSizeBytes: 100 * 1024,
          uncompressedSizeBytes: 60 * 1024 * 1024,
          fileCount: 10,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "EARC_DECOMPRESSION_BOMB",
          limitRatio: 250,
        }),
      );
    });

    it("rejects total uncompressed size exceeding safe boundary", () => {
      const customMax = 100 * 1024 * 1024; // 100 MiB limit
      expect(() =>
        assertArchiveDecompressionSafety(
          {
            compressedSizeBytes: 80 * 1024 * 1024,
            uncompressedSizeBytes: 120 * 1024 * 1024,
            fileCount: 50,
          },
          { maxDecompressedSizeBytes: customMax },
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "EARC_SIZE_EXCEEDED",
          limit: customMax,
        }),
      );
    });

    it("rejects file count exceeding maximum allowable entries (inode protection)", () => {
      const customMaxFiles = 500;
      expect(() =>
        assertArchiveDecompressionSafety(
          {
            compressedSizeBytes: 1024,
            uncompressedSizeBytes: 2048,
            fileCount: 501,
          },
          { maxFileCount: customMaxFiles },
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "EARC_FILE_COUNT_EXCEEDED",
          limit: customMaxFiles,
        }),
      );
    });
  });

  describe("assertArchiveSafeToExtract", () => {
    it("rejects oversized metadata before an extractor can write files", async () => {
      const archiveDir = await createTempDir();
      const destination = await createTempDir();
      const archivePath = path.join(archiveDir, "bomb.zip");
      await fs.writeFile(archivePath, Buffer.alloc(1024));
      const list = vi.fn(async (_archivePath, _options, onEntries) => {
        onEntries([{ attr: "A", name: "payload.bin", size: 20_000 }]);
      });

      await expect(
        assertArchiveSafeToExtract({ list }, archivePath, destination, {
          limits: { maxDecompressedSizeBytes: 10_000 },
          platform: "linux",
        }),
      ).rejects.toMatchObject({ code: "EARC_SIZE_EXCEEDED" });
      expect(list).toHaveBeenCalledOnce();
    });

    it("allows ordinary archive metadata and passes a supplied password", async () => {
      const archiveDir = await createTempDir();
      const destination = await createTempDir();
      const archivePath = path.join(archiveDir, "mod.7z");
      await fs.writeFile(archivePath, Buffer.alloc(1024));
      const list = vi.fn(async (_archivePath, options, onEntries) => {
        expect(options).toEqual({ p: "secret" });
        onEntries([{ attr: "A", name: "meshes/model.nif", size: 2048 }]);
      });

      await expect(
        assertArchiveSafeToExtract({ list }, archivePath, destination, {
          password: "secret",
          platform: "linux",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("ArchiveSafetyTracker", () => {
    it("rejects an entry exceeding the per-file limit", () => {
      const tracker = new ArchiveSafetyTracker({
        compressedSizeBytes: 1024,
        limits: { maxDecompressedSizeBytes: 100_000, maxFileSizeBytes: 10_000 },
        platform: "linux",
      });

      expect(() =>
        tracker.processEntry({ path: "oversized.bin", uncompressedSize: 10_001 }),
      ).toThrowError(
        expect.objectContaining({
          code: "EARC_FILE_SIZE_EXCEEDED",
          limit: 10_000,
          path: "oversized.bin",
        }),
      );
    });

    it("allows an entry exactly at the per-file limit", () => {
      const tracker = new ArchiveSafetyTracker({
        compressedSizeBytes: 1024,
        limits: { maxDecompressedSizeBytes: 10_000, maxFileSizeBytes: 10_000 },
        platform: "linux",
      });

      expect(() =>
        tracker.processEntry({ path: "boundary.bin", uncompressedSize: 10_000 }),
      ).not.toThrow();
    });

    it("tracks valid entries and aggregates statistics", () => {
      const tracker = new ArchiveSafetyTracker({
        compressedSizeBytes: 10 * 1024 * 1024,
        destinationRoot: "/games/skyrim",
        platform: "linux",
      });

      tracker.processEntry({
        path: "Data/textures/armor.dds",
        uncompressedSize: 5 * 1024 * 1024,
        mode: S_IFREG | 0o644,
      });

      tracker.processEntry({
        path: "Data/meshes/armor.nif",
        uncompressedSize: 2 * 1024 * 1024,
        mode: S_IFREG | 0o644,
      });

      const stats = tracker.getStats();
      expect(stats.fileCount).toBe(2);
      expect(stats.uncompressedSizeBytes).toBe(7 * 1024 * 1024);
      expect(stats.compressionRatio).toBeCloseTo(0.7, 1);
    });

    it("rejects entries with special POSIX device modes (FIFO, Character Device)", () => {
      const tracker = new ArchiveSafetyTracker({
        compressedSizeBytes: 1024,
        destinationRoot: "/games/skyrim",
        platform: "linux",
      });

      expect(() =>
        tracker.processEntry({
          path: "Data/malicious_fifo",
          mode: S_IFIFO | 0o644,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "EDEPLOYMENTSPECIALDEVICE",
          deviceType: "fifo",
        }),
      );

      expect(() =>
        tracker.processEntry({
          path: "Data/dev_zero",
          mode: S_IFCHR | 0o660,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "EDEPLOYMENTSPECIALDEVICE",
          deviceType: "character_device",
        }),
      );
    });

    it("rejects tar typeflag special device entries", () => {
      const tracker = new ArchiveSafetyTracker({
        compressedSizeBytes: 1024,
        destinationRoot: "/games/skyrim",
        platform: "linux",
      });

      // '6' = FIFO in tar
      expect(() =>
        tracker.processEntry({
          path: "Data/named_pipe",
          typeflag: "6",
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "EDEPLOYMENTSPECIALDEVICE",
          deviceType: "fifo",
        }),
      );
    });

    it("rejects Zip-Slip directory traversal attempts in entry path", () => {
      const tracker = new ArchiveSafetyTracker({
        compressedSizeBytes: 1024,
        destinationRoot: "/games/skyrim",
        platform: "linux",
      });

      expect(() =>
        tracker.processEntry({
          path: "../../etc/shadow",
          uncompressedSize: 100,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "EDEPLOYMENTOUTSIDEROOT",
        }),
      );
    });

    it("rejects oversized component names (>255 UTF-8 bytes)", () => {
      const tracker = new ArchiveSafetyTracker({
        compressedSizeBytes: 1024,
        destinationRoot: "/games/skyrim",
        platform: "linux",
      });

      const longComponent = "a".repeat(256);
      expect(() =>
        tracker.processEntry({
          path: `Data/${longComponent}`,
          uncompressedSize: 100,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "ENAMETOOLONG",
        }),
      );
    });

    it("throws when decompression bomb threshold is breached incrementally", () => {
      const tracker = new ArchiveSafetyTracker({
        compressedSizeBytes: 10 * 1024, // 10 KiB
        destinationRoot: "/games/skyrim",
        limits: {
          maxCompressionRatio: 50,
          minRatioThresholdBytes: 1024, // Trigger immediately for test
        },
        platform: "linux",
      });

      tracker.processEntry({
        path: "Data/file1.bin",
        uncompressedSize: 100 * 1024, // 10:1 ratio - safe
      });

      expect(() =>
        tracker.processEntry({
          path: "Data/file2.bin",
          uncompressedSize: 1000 * 1024, // now 1100 KiB / 10 KiB = 110:1 > 50:1
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "EARC_DECOMPRESSION_BOMB",
        }),
      );
    });
  });

  describe("assertLinuxSafeExtractedTree", () => {
    it("validates safe extracted directory tree with files and subdirectories", async () => {
      const tree = await createTempDir();
      await fs.mkdir(path.join(tree, "textures"), { recursive: true });
      await fs.writeFile(path.join(tree, "textures", "diffuse.dds"), "dds-content");
      await fs.writeFile(path.join(tree, "readme.txt"), "readme text");

      const result = await assertLinuxSafeExtractedTree(tree, { platform: "linux" });
      expect(result.fileCount).toBe(3); // 1 subdir + 2 files
      expect(result.totalBytes).toBe(11 + 11); // 11 + 11 bytes
    });

    it("detects real POSIX FIFO (named pipe) in extracted tree on Linux", async () => {
      const tree = await createTempDir();
      const fifoPath = path.join(tree, "suspicious.pipe");

      try {
        execSync(`mkfifo "${fifoPath}"`);
      } catch {
        // Fallback if environment forbids mkfifo
        return;
      }

      await expect(assertLinuxSafeExtractedTree(tree, { platform: "linux" })).rejects.toMatchObject(
        {
          code: "EDEPLOYMENTSPECIALDEVICE",
          deviceType: "fifo",
          path: fifoPath,
        },
      );
    });

    it("detects escaping symlink in extracted tree", async () => {
      const tree = await createTempDir();
      const outside = await createTempDir();
      const outsideFile = path.join(outside, "secret.txt");
      await fs.writeFile(outsideFile, "secret");

      const linkPath = path.join(tree, "link_to_outside");
      await fs.symlink(outsideFile, linkPath);

      await expect(assertLinuxSafeExtractedTree(tree, { platform: "linux" })).rejects.toMatchObject(
        {
          code: "EDEPLOYMENTSYMLINK",
          path: linkPath,
        },
      );
    });

    it("detects broken symlink or link loop in extracted tree", async () => {
      const tree = await createTempDir();
      const brokenLink = path.join(tree, "dangling.link");
      await fs.symlink(path.join(tree, "does_not_exist"), brokenLink);

      await expect(assertLinuxSafeExtractedTree(tree, { platform: "linux" })).rejects.toMatchObject(
        {
          code: "EDEPLOYMENTBROKENSYMLINK",
          path: brokenLink,
        },
      );
    });

    it("rejects extracted tree exceeding decompression ratio when archive path is provided", async () => {
      const tree = await createTempDir();
      const archiveDir = await createTempDir();
      const archivePath = path.join(archiveDir, "mod.zip");

      // Write a tiny 100-byte dummy archive
      await fs.writeFile(archivePath, Buffer.alloc(100));

      // In the tree, create 60 MiB of extracted files (600,000:1 ratio)
      const bigBuffer = Buffer.alloc(1024 * 1024); // 1 MiB
      for (let i = 0; i < 60; i++) {
        await fs.writeFile(path.join(tree, `chunk_${i}.dat`), bigBuffer);
      }

      await expect(
        assertLinuxSafeExtractedTree(tree, {
          archivePath,
          platform: "linux",
        }),
      ).rejects.toMatchObject({
        code: "EARC_DECOMPRESSION_BOMB",
      });
    });

    it("is completely bypassed on non-Linux platforms", async () => {
      const tree = await createTempDir();
      const outside = path.join(tree, "..", "outside");
      await fs.symlink(outside, path.join(tree, "escape_link"));

      const result = await assertLinuxSafeExtractedTree(tree, { platform: "win32" });
      expect(result).toEqual({ fileCount: 0, totalBytes: 0 });
    });
  });
});
