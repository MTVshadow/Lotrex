import * as path from "node:path";

import { getErrorCode } from "@vortex/shared";

import * as fs from "../fs";
import { assertLinuxPathLimits } from "./pathLimits";
import { isWithinRoot } from "./pathSafety";

/**
 * Standard POSIX file type bit masks (sys/stat.h).
 * Used to detect special device nodes, named pipes (FIFOs), and sockets in archive headers.
 */
export const S_IFMT = 0o170000; // Bit mask for the file type bit fields
export const S_IFSOCK = 0o140000; // Socket
export const S_IFLNK = 0o120000; // Symbolic link
export const S_IFREG = 0o100000; // Regular file
export const S_IFBLK = 0o060000; // Block device (e.g. /dev/sda)
export const S_IFDIR = 0o040000; // Directory
export const S_IFCHR = 0o020000; // Character device (e.g. /dev/zero, /dev/null)
export const S_IFIFO = 0o010000; // FIFO / named pipe

export type PosixSpecialDeviceType = "fifo" | "character_device" | "block_device" | "socket";

/**
 * Default threshold constants for archive decompression safety.
 * These can be overridden via options or environment variables:
 * - VORTEX_ARCHIVE_MAX_BYTES: maximum uncompressed bytes allowed
 * - VORTEX_ARCHIVE_MAX_FILE_BYTES: maximum uncompressed bytes allowed for one entry
 * - VORTEX_ARCHIVE_MAX_RATIO: maximum compression ratio (uncompressed / compressed)
 * - VORTEX_ARCHIVE_MAX_FILES: maximum number of entries
 */
export const DEFAULT_MAX_DECOMPRESSED_SIZE_BYTES = 50 * 1024 * 1024 * 1024; // 50 GiB
export const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB
export const DEFAULT_MAX_COMPRESSION_RATIO = 250; // 250:1 ratio
export const DEFAULT_MIN_RATIO_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MiB minimum before ratio kicks in
export const DEFAULT_MAX_FILE_COUNT = 250_000;

export interface IArchiveSafetyLimits {
  /** Maximum allowed uncompressed byte size across all entries (default: 50 GiB). */
  maxDecompressedSizeBytes?: number;
  /** Maximum allowed uncompressed byte size for one archive entry (default: 10 GiB). */
  maxFileSizeBytes?: number;
  /** Maximum compression ratio (uncompressed / compressed) allowed (default: 250). */
  maxCompressionRatio?: number;
  /** Minimum uncompressed threshold in bytes before compression ratio is evaluated (default: 50 MiB). */
  minRatioThresholdBytes?: number;
  /** Maximum number of file and directory entries allowed in an archive (default: 250,000). */
  maxFileCount?: number;
}

export interface IArchiveDecompressionStats {
  compressedSizeBytes: number;
  uncompressedSizeBytes: number;
  fileCount: number;
}

export interface IArchiveEntryInfo {
  path: string;
  uncompressedSize?: number;
  compressedSize?: number;
  mode?: number;
  typeflag?: string;
  attributes?: string;
}

export interface IArchiveListing {
  list: (
    archivePath: string,
    options: Record<string, unknown>,
    onEntries: (entries: Array<{ attr?: string; name: string; size?: number }>) => void,
  ) => PromiseLike<unknown>;
}

/**
 * Inspect archive metadata before extraction starts so declared path, entry-count, and
 * decompressed-size limits can reject an archive before it consumes destination resources.
 * The post-extraction tree validation remains required because archive metadata can be malformed.
 */
export async function assertArchiveSafeToExtract(
  listing: IArchiveListing,
  archivePath: string,
  destinationRoot: string,
  options: ISafeExtractedTreeOptions & { password?: string } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") return;

  const archiveStats = await fs.statAsync(archivePath);
  const tracker = new ArchiveSafetyTracker({
    compressedSizeBytes: archiveStats.size,
    destinationRoot,
    limits: options.limits,
    platform,
  });
  const listOptions: Record<string, unknown> = {};
  if (options.password !== undefined) listOptions.p = options.password;

  await listing.list(archivePath, listOptions, (entries) => {
    entries.forEach((entry) =>
      tracker.processEntry({
        attributes: entry.attr,
        path: entry.name,
        uncompressedSize: entry.size,
      }),
    );
  });
}

/**
 * Determines whether a given POSIX mode represents a special device file
 * (FIFO named pipe, character device, block device, or Unix domain socket).
 *
 * Regular files, directories, and symlinks return undefined.
 */
export function getPosixSpecialDeviceType(mode: number): PosixSpecialDeviceType | undefined {
  const fileType = mode & S_IFMT;
  if (fileType === S_IFIFO) return "fifo";
  if (fileType === S_IFCHR) return "character_device";
  if (fileType === S_IFBLK) return "block_device";
  if (fileType === S_IFSOCK) return "socket";
  return undefined;
}

/**
 * Evaluates decompression stats against configured safety limits to prevent
 * decompression bomb attacks (Zip bombs / tar bombs):
 * 1. Limits maximum total uncompressed size (prevents disk space exhaustion).
 * 2. Limits maximum entry count (prevents inode exhaustion and memory spikes).
 * 3. Enforces maximum compression ratio (e.g. 250:1), but only after a minimum
 *    uncompressed threshold (e.g. 50 MiB) so small, benign repetitive files
 *    (e.g. 100-byte plain text templates) are not falsely flagged.
 */
export function assertArchiveDecompressionSafety(
  stats: IArchiveDecompressionStats,
  customLimits: IArchiveSafetyLimits = {},
): void {
  const maxDecompressed =
    customLimits.maxDecompressedSizeBytes ??
    (process.env.VORTEX_ARCHIVE_MAX_BYTES
      ? Number.parseInt(process.env.VORTEX_ARCHIVE_MAX_BYTES, 10)
      : DEFAULT_MAX_DECOMPRESSED_SIZE_BYTES);

  const maxRatio =
    customLimits.maxCompressionRatio ??
    (process.env.VORTEX_ARCHIVE_MAX_RATIO
      ? Number.parseInt(process.env.VORTEX_ARCHIVE_MAX_RATIO, 10)
      : DEFAULT_MAX_COMPRESSION_RATIO);

  const minRatioThreshold =
    customLimits.minRatioThresholdBytes ?? DEFAULT_MIN_RATIO_THRESHOLD_BYTES;

  const maxFiles =
    customLimits.maxFileCount ??
    (process.env.VORTEX_ARCHIVE_MAX_FILES
      ? Number.parseInt(process.env.VORTEX_ARCHIVE_MAX_FILES, 10)
      : DEFAULT_MAX_FILE_COUNT);

  // 1. Inode / entry count limit check
  if (stats.fileCount > maxFiles) {
    const err = new Error(
      `Archive entry count (${stats.fileCount}) exceeds safe limit (${maxFiles})`,
    );
    err["code"] = "EARC_FILE_COUNT_EXCEEDED";
    err["fileCount"] = stats.fileCount;
    err["limit"] = maxFiles;
    throw err;
  }

  // 2. Absolute uncompressed size limit check
  if (stats.uncompressedSizeBytes > maxDecompressed) {
    const err = new Error(
      `Archive decompressed size (${stats.uncompressedSizeBytes} bytes) exceeds safe limit (${maxDecompressed} bytes)`,
    );
    err["code"] = "EARC_SIZE_EXCEEDED";
    err["uncompressedBytes"] = stats.uncompressedSizeBytes;
    err["limit"] = maxDecompressed;
    throw err;
  }

  // 3. Compression ratio check (Decompression Bomb protection)
  // Only evaluate when uncompressed size exceeds minRatioThreshold to avoid false positives on small files.
  if (stats.uncompressedSizeBytes >= minRatioThreshold) {
    const effectiveCompressed = Math.max(1, stats.compressedSizeBytes);
    const ratio = stats.uncompressedSizeBytes / effectiveCompressed;
    if (ratio > maxRatio) {
      const err = new Error(
        `Potential decompression bomb detected: compression ratio ${ratio.toFixed(1)}:1 exceeds safety limit ${maxRatio}:1 ` +
          `(uncompressed: ${stats.uncompressedSizeBytes} bytes, compressed: ${stats.compressedSizeBytes} bytes)`,
      );
      err["code"] = "EARC_DECOMPRESSION_BOMB";
      err["ratio"] = ratio;
      err["limitRatio"] = maxRatio;
      err["uncompressedBytes"] = stats.uncompressedSizeBytes;
      err["compressedBytes"] = stats.compressedSizeBytes;
      throw err;
    }
  }
}

/**
 * State tracker for streaming or entry-by-entry archive inspection.
 * Enforces path limits, Zip-slip containment, POSIX special device restrictions,
 * and decompression limits incrementally as archive entries are read.
 */
export class ArchiveSafetyTracker {
  private mCompressedSize: number;
  private mUncompressedSize = 0;
  private mFileCount = 0;
  private mLimits: IArchiveSafetyLimits;
  private mDestinationRoot?: string;
  private mPlatform: NodeJS.Platform;

  constructor(options: {
    compressedSizeBytes: number;
    destinationRoot?: string;
    limits?: IArchiveSafetyLimits;
    platform?: NodeJS.Platform;
  }) {
    this.mCompressedSize = options.compressedSizeBytes;
    this.mDestinationRoot = options.destinationRoot;
    this.mLimits = options.limits ?? {};
    this.mPlatform = options.platform ?? process.platform;
  }

  /**
   * Processes a single archive entry before or during extraction.
   * Throws an error immediately if the entry violates security constraints.
   */
  public processEntry(entry: IArchiveEntryInfo): void {
    this.mFileCount += 1;
    if (entry.uncompressedSize != null && entry.uncompressedSize > 0) {
      const maxFileSize =
        this.mLimits.maxFileSizeBytes ??
        (process.env.VORTEX_ARCHIVE_MAX_FILE_BYTES
          ? Number.parseInt(process.env.VORTEX_ARCHIVE_MAX_FILE_BYTES, 10)
          : DEFAULT_MAX_FILE_SIZE_BYTES);
      if (entry.uncompressedSize > maxFileSize) {
        const err = new Error(
          `Archive entry ${entry.path} (${entry.uncompressedSize} bytes) exceeds safe per-file limit (${maxFileSize} bytes)`,
        );
        err["code"] = "EARC_FILE_SIZE_EXCEEDED";
        err["path"] = entry.path;
        err["uncompressedBytes"] = entry.uncompressedSize;
        err["limit"] = maxFileSize;
        throw err;
      }
      this.mUncompressedSize += entry.uncompressedSize;
    }

    // 1. Reject special POSIX device modes (FIFO, Character Device, Block Device, Socket)
    if (entry.mode != null) {
      const specialType = getPosixSpecialDeviceType(entry.mode);
      if (specialType != null) {
        const err = new Error(
          `Refusing to extract archive containing special POSIX device entry: ${entry.path} (${specialType})`,
        );
        err["code"] = "EDEPLOYMENTSPECIALDEVICE";
        err["path"] = entry.path;
        err["deviceType"] = specialType;
        throw err;
      }
    }

    // 2. Reject tar format typeflags ('3'=CHR, '4'=BLK, '6'=FIFO)
    if (entry.typeflag != null) {
      if (entry.typeflag === "3" || entry.typeflag === "4" || entry.typeflag === "6") {
        const specialType: PosixSpecialDeviceType =
          entry.typeflag === "6"
            ? "fifo"
            : entry.typeflag === "3"
              ? "character_device"
              : "block_device";
        const err = new Error(
          `Refusing to extract archive containing special POSIX device entry flag: ${entry.path} (${specialType})`,
        );
        err["code"] = "EDEPLOYMENTSPECIALDEVICE";
        err["path"] = entry.path;
        err["deviceType"] = specialType;
        throw err;
      }
    }

    // 3. Zip-slip lexical containment and Linux path limits
    if (this.mDestinationRoot != null) {
      const resolved = path.resolve(this.mDestinationRoot, entry.path);
      if (!isWithinRoot(this.mDestinationRoot, resolved)) {
        const err = new Error(
          `Zip-slip path traversal attempt detected in archive entry: ${entry.path}`,
        );
        err["code"] = "EDEPLOYMENTOUTSIDEROOT";
        err["path"] = resolved;
        throw err;
      }
      assertLinuxPathLimits([resolved], this.mPlatform);
    } else {
      assertLinuxPathLimits([entry.path], this.mPlatform);
    }

    // 4. Decompression limits check (bombs, max bytes, max files)
    assertArchiveDecompressionSafety(
      {
        compressedSizeBytes: this.mCompressedSize,
        uncompressedSizeBytes: this.mUncompressedSize,
        fileCount: this.mFileCount,
      },
      this.mLimits,
    );
  }

  /**
   * Returns current accumulated decompression statistics.
   */
  public getStats(): IArchiveDecompressionStats & { compressionRatio: number } {
    const ratio = this.mUncompressedSize / Math.max(1, this.mCompressedSize);
    return {
      fileCount: this.mFileCount,
      compressedSizeBytes: this.mCompressedSize,
      uncompressedSizeBytes: this.mUncompressedSize,
      compressionRatio: ratio,
    };
  }
}

export interface ISafeExtractedTreeOptions {
  platform?: NodeJS.Platform;
  archivePath?: string;
  limits?: IArchiveSafetyLimits;
}

/**
 * Defensive post-extraction / pre-inspection validator for an extracted directory tree.
 *
 * Walks the target directory recursively using `fs.lstatAsync` (so symlinks are not followed):
 * 1. Rejects any special POSIX devices (FIFOs/named pipes, sockets, character/block devices)
 *    to prevent hangs or device tampering during subsequent file reading or hashing.
 * 2. Validates that symbolic links do not escape the extracted directory root and are not broken loops.
 * 3. Enforces Linux path limits on all paths.
 * 4. Checks total uncompressed byte size and compression ratio against the source archive if provided.
 */
export async function assertLinuxSafeExtractedTree(
  targetDirectory: string,
  options: ISafeExtractedTreeOptions = {},
): Promise<{ fileCount: number; totalBytes: number }> {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") {
    return { fileCount: 0, totalBytes: 0 };
  }

  const resolvedRoot = path.resolve(targetDirectory);
  let fileCount = 0;
  let totalBytes = 0;

  async function inspectDirectory(currentDir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdirAsync(currentDir);
    } catch (err: unknown) {
      if (getErrorCode(err) === "ENOENT") return;
      throw err;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);

      // Validate Linux path limits (255 bytes name / 4096 bytes path)
      assertLinuxPathLimits([fullPath], platform);

      let stats: fs.Stats;
      try {
        // Use lstatAsync: critical so we inspect the link itself, rather than following it!
        stats = await fs.lstatAsync(fullPath);
      } catch (err: unknown) {
        if (getErrorCode(err) === "ENOENT") continue;
        throw err;
      }

      // Check for special POSIX devices
      if (
        stats.isFIFO() ||
        stats.isSocket() ||
        stats.isCharacterDevice() ||
        stats.isBlockDevice()
      ) {
        const deviceType: PosixSpecialDeviceType = stats.isFIFO()
          ? "fifo"
          : stats.isSocket()
            ? "socket"
            : stats.isCharacterDevice()
              ? "character_device"
              : "block_device";
        const err = new Error(
          `Refusing to process special POSIX device file in extracted tree: ${fullPath} (${deviceType})`,
        );
        err["code"] = "EDEPLOYMENTSPECIALDEVICE";
        err["path"] = fullPath;
        err["deviceType"] = deviceType;
        throw err;
      }

      // Check symbolic links
      if (stats.isSymbolicLink()) {
        fileCount += 1;
        const linkTarget = await fs.readlinkAsync(fullPath);
        const resolvedTarget = path.resolve(path.dirname(fullPath), linkTarget);

        if (!isWithinRoot(resolvedRoot, resolvedTarget)) {
          const err = new Error(
            `Refusing to follow symbolic link escaping extracted tree: ${fullPath} -> ${resolvedTarget}`,
          );
          err["code"] = "EDEPLOYMENTSYMLINK";
          err["path"] = fullPath;
          throw err;
        }

        // Verify that the link target is not dangling or a self-referential loop
        try {
          await fs.statAsync(fullPath);
        } catch (statErr: unknown) {
          const code = getErrorCode(statErr);
          if (code === "ENOENT" || code === "ELOOP") {
            const err = new Error(
              `Broken symbolic link or loop detected in extracted tree: ${fullPath}`,
            );
            err["code"] = "EDEPLOYMENTBROKENSYMLINK";
            err["path"] = fullPath;
            throw err;
          }
          throw statErr;
        }
        continue;
      }

      if (stats.isDirectory()) {
        fileCount += 1;
        await inspectDirectory(fullPath);
      } else if (stats.isFile()) {
        fileCount += 1;
        totalBytes += stats.size;
      }
    }
  }

  await inspectDirectory(resolvedRoot);

  // If source archive path is specified, determine compressed size and verify decompression safety
  if (options.archivePath) {
    try {
      const archiveStat = await fs.statAsync(options.archivePath);
      assertArchiveDecompressionSafety(
        {
          compressedSizeBytes: archiveStat.size,
          uncompressedSizeBytes: totalBytes,
          fileCount,
        },
        options.limits,
      );
    } catch (err: unknown) {
      if (getErrorCode(err) === "ENOENT") {
        // If archive is absent (e.g. already cleaned up or test stub), check limits without ratio
        assertArchiveDecompressionSafety(
          {
            compressedSizeBytes: totalBytes, // fallback to 1:1
            uncompressedSizeBytes: totalBytes,
            fileCount,
          },
          options.limits,
        );
      } else {
        throw err;
      }
    }
  } else {
    // If no archive path provided, verify size and file count limits
    assertArchiveDecompressionSafety(
      {
        compressedSizeBytes: totalBytes,
        uncompressedSizeBytes: totalBytes,
        fileCount,
      },
      options.limits,
    );
  }

  return { fileCount, totalBytes };
}
