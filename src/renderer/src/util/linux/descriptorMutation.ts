import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";

import { getErrorCode, getErrorMessageOrDefault, unknownToError } from "@vortex/shared";

import {
  assertLinuxPathHasNoSymlinkAncestors,
  type IParentIdentity,
  isWithinRoot,
} from "./pathSafety";

export interface IDescriptorMutationOptions {
  platform?: NodeJS.Platform;
  expectedParentIdentity?: IParentIdentity;
  skipOwnershipCheck?: boolean;
}

export interface ILinuxDirectoryHandle {
  /** Numerical file descriptor representing the opened parent directory */
  readonly fd: number;
  /** Full resolved path to the parent directory */
  readonly parentPath: string;
  /** Verified physical filesystem identity (dev and inode) */
  readonly parentIdentity: IParentIdentity;
  /** Returns the descriptor-bound path targeting /proc/self/fd/<fd>/<leaf> */
  fdPath(leafName: string): string;
  /** Creates a hard link targeting sourcePath bound strictly to this directory handle */
  linkFile(sourcePath: string, leafName: string): Promise<void>;
  /** Creates a symbolic link targeting sourcePath bound strictly to this directory handle */
  symlinkFile(sourcePath: string, leafName: string): Promise<void>;
  /** Unlinks a file entry bound strictly to this directory handle */
  unlinkFile(leafName: string): Promise<void>;
  /** Atomically renames a file within this directory handle */
  renameFile(fromLeaf: string, toLeaf: string): Promise<void>;
  /** Inspects leaf file stats within this directory handle without following symlinks */
  statFile(leafName: string): Promise<fs.Stats>;
  /** Safely creates a backup file (.vortex_backup) if leaf exists */
  ensureBackup(leafName: string, backupTag: string): Promise<void>;
  /** Safely restores a backup file (.vortex_backup) if backup exists */
  restoreBackup(leafName: string, backupTag: string): Promise<void>;
}

/**
 * Checks whether the host system supports descriptor-bound mutations via /proc/self/fd.
 */
export function isDescriptorMutationSupported(
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "linux") {
    return false;
  }
  try {
    fs.accessSync("/proc/self/fd", fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates that a leaf name does not contain directory separators or parent traversals.
 */
function assertValidLeafName(leafName: string): void {
  if (
    !leafName ||
    leafName === "." ||
    leafName === ".." ||
    leafName.includes("/") ||
    leafName.includes("\\")
  ) {
    const err = new Error(`Invalid leaf filename for descriptor-bound mutation: "${leafName}"`);
    err["code"] = "EINVAL";
    throw err;
  }
}

/**
 * Opens and verifies a destination parent directory handle on Linux, enforcing:
 * 1. Root containment (no escaping managed dataPath).
 * 2. Ancestor hierarchy contains no symbolic links.
 * 3. Parent directory exists, is a real directory, and matches expected (dev, ino) identity.
 * 4. Ownership invariant: owned by current user or root; not world-writable without sticky bit.
 *
 * Educational note:
 * Operating on raw pathnames introduces Time-of-Check to Time-of-Use (TOCTOU) races where an attacker
 * can swap a checked directory with a symlink before the subsequent link/unlink/rename occurs.
 * By pinning an open file descriptor (`O_DIRECTORY`) and routing mutations through `/proc/self/fd/<fd>/<leaf>`,
 * the Linux kernel VFS resolves the operation strictly against the verified directory inode,
 * immunizing the deployment pipeline against concurrent directory substitutions.
 */
export async function openLinuxDestinationHandle(
  rootPath: string,
  candidatePath: string,
  options: IDescriptorMutationOptions = {},
): Promise<ILinuxDirectoryHandle & { close: () => Promise<void> }> {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") {
    const err = new Error("Descriptor-bound directory mutations are only supported on Linux");
    err["code"] = "ENOSYS";
    throw err;
  }

  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(resolvedRoot, candidatePath);
  const resolvedParent = path.dirname(resolvedCandidate);

  // 1. Root containment check
  if (
    !isWithinRoot(resolvedRoot, resolvedCandidate) ||
    !isWithinRoot(resolvedRoot, resolvedParent)
  ) {
    const err = new Error(`Refusing to access path outside its managed root: ${resolvedCandidate}`);
    err["code"] = "EDEPLOYMENTOUTSIDEROOT";
    err["path"] = resolvedCandidate;
    throw err;
  }

  // 2. Ancestor symlink traversal validation
  await assertLinuxPathHasNoSymlinkAncestors(resolvedRoot, resolvedCandidate, platform);

  // 3. Open directory file descriptor with O_DIRECTORY | O_CLOEXEC
  let fileHandle: fsPromises.FileHandle;
  try {
    fileHandle = await fsPromises.open(
      resolvedParent,
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
    );
  } catch (err: unknown) {
    const code = getErrorCode(err);
    if (code === "ENOENT" && options.expectedParentIdentity !== undefined) {
      const raceErr = new Error(
        `Destination parent directory disappeared before mutation: ${resolvedParent}`,
      );
      raceErr["code"] = "EDEPLOYMENTPARENTCHANGED";
      raceErr["path"] = resolvedParent;
      throw raceErr;
    }
    throw err;
  }

  try {
    // Inspect directory status directly from the open file descriptor
    const stats = await fileHandle.stat();

    if (!stats.isDirectory()) {
      const err = new Error(`Deployment destination parent is not a directory: ${resolvedParent}`);
      err["code"] = "ENOTDIR";
      err["path"] = resolvedParent;
      throw err;
    }

    const currentIdentity: IParentIdentity = { dev: stats.dev, ino: stats.ino };

    // Verify expected directory identity to catch directory swap races
    if (options.expectedParentIdentity !== undefined) {
      const expected = options.expectedParentIdentity;
      if (stats.dev !== expected.dev || stats.ino !== expected.ino) {
        const err = new Error(
          `Destination parent directory identity changed (TOCTOU race detected): ${resolvedParent} (expected ino ${expected.ino}, got ${stats.ino})`,
        );
        err["code"] = "EDEPLOYMENTPARENTCHANGED";
        err["path"] = resolvedParent;
        err["expected"] = expected;
        err["actual"] = currentIdentity;
        throw err;
      }
    }

    // 4. Enforce Phase 1 Ownership and Security Invariant
    if (!options.skipOwnershipCheck) {
      const isWorldWritable = (stats.mode & 0o002) !== 0;
      const hasStickyBit = (stats.mode & 0o1000) !== 0;
      if (isWorldWritable && !hasStickyBit) {
        const err = new Error(
          `Deployment parent directory is world-writable without sticky bit: ${resolvedParent}`,
        );
        err["code"] = "EDEPLOYMENTUNSAFEPERMISSIONS";
        err["path"] = resolvedParent;
        throw err;
      }

      const isGroupWritable = (stats.mode & 0o020) !== 0;
      if (isGroupWritable) {
        const currentGid = typeof process.getgid === "function" ? process.getgid() : -1;
        const currentGroups = typeof process.getgroups === "function" ? process.getgroups() : [];
        if (
          currentGid !== -1 &&
          stats.gid !== currentGid &&
          !currentGroups.includes(stats.gid) &&
          stats.uid !== 0
        ) {
          const err = new Error(
            `Deployment parent directory is group-writable by untrusted group: ${resolvedParent}`,
          );
          err["code"] = "EDEPLOYMENTUNSAFEPERMISSIONS";
          err["path"] = resolvedParent;
          throw err;
        }
      }

      const currentUid = typeof process.getuid === "function" ? process.getuid() : -1;
      if (currentUid !== -1 && currentUid !== 0 && stats.uid !== currentUid && stats.uid !== 0) {
        const err = new Error(
          `Deployment parent directory is owned by an untrusted user (UID ${stats.uid}): ${resolvedParent}`,
        );
        err["code"] = "EDEPLOYMENTUNSAFEPERMISSIONS";
        err["path"] = resolvedParent;
        throw err;
      }
    }

    const fd = fileHandle.fd;

    const fdPath = (leafName: string): string => {
      assertValidLeafName(leafName);
      return `/proc/self/fd/${fd}/${leafName}`;
    };

    const handle: ILinuxDirectoryHandle & { close: () => Promise<void> } = {
      fd,
      parentPath: resolvedParent,
      parentIdentity: currentIdentity,
      fdPath,

      async statFile(leafName: string): Promise<fs.Stats> {
        return fsPromises.lstat(fdPath(leafName));
      },

      async linkFile(sourcePath: string, leafName: string): Promise<void> {
        const target = fdPath(leafName);
        try {
          await fsPromises.link(sourcePath, target);
        } catch (err: unknown) {
          const code = getErrorCode(err);
          if (code === "EXDEV") {
            const exdevErr = new Error(
              `Cannot create hardlink across different filesystems (from "${sourcePath}" to "${resolvedParent}/${leafName}"). ` +
                "On Linux, hardlinks only work on the same filesystem partition.",
            );
            exdevErr["code"] = "EXDEV";
            throw exdevErr;
          }
          if (code === "EEXIST") {
            // Unlink existing target and retry
            await fsPromises.unlink(target);
            await fsPromises.link(sourcePath, target);
            return;
          }
          throw unknownToError(err);
        }
      },

      async symlinkFile(sourcePath: string, leafName: string): Promise<void> {
        const target = fdPath(leafName);
        try {
          await fsPromises.symlink(sourcePath, target);
        } catch (err: unknown) {
          if (getErrorCode(err) === "EEXIST") {
            await fsPromises.unlink(target);
            await fsPromises.symlink(sourcePath, target);
            return;
          }
          throw unknownToError(err);
        }
      },

      async unlinkFile(leafName: string): Promise<void> {
        const target = fdPath(leafName);
        try {
          await fsPromises.unlink(target);
        } catch (err: unknown) {
          if (getErrorCode(err) !== "ENOENT") {
            throw unknownToError(err);
          }
        }
      },

      async renameFile(fromLeaf: string, toLeaf: string): Promise<void> {
        await fsPromises.rename(fdPath(fromLeaf), fdPath(toLeaf));
      },

      async ensureBackup(leafName: string, backupTag: string): Promise<void> {
        const backupLeaf = leafName + backupTag;
        try {
          await fsPromises.lstat(fdPath(leafName));
          // If leaf exists, rename it to backupLeaf
          await fsPromises.rename(fdPath(leafName), fdPath(backupLeaf));
        } catch (err: unknown) {
          if (getErrorCode(err) !== "ENOENT") {
            throw unknownToError(err);
          }
        }
      },

      async restoreBackup(leafName: string, backupTag: string): Promise<void> {
        const backupLeaf = leafName + backupTag;
        try {
          await fsPromises.lstat(fdPath(backupLeaf));
          await fsPromises.rename(fdPath(backupLeaf), fdPath(leafName));
        } catch (err: unknown) {
          if (getErrorCode(err) !== "ENOENT") {
            throw unknownToError(err);
          }
        }
      },

      close: async () => {
        await fileHandle.close();
      },
    };

    return handle;
  } catch (err) {
    await fileHandle.close();
    throw err;
  }
}

/**
 * Scoped execution wrapper that opens a verified Linux directory handle,
 * runs mutations inside the provided callback, and guarantees cleanup of the descriptor.
 */
export async function withLinuxDescriptorMutation<T>(
  rootPath: string,
  candidatePath: string,
  fn: (handle: ILinuxDirectoryHandle) => Promise<T>,
  options: IDescriptorMutationOptions = {},
): Promise<T> {
  const handle = await openLinuxDestinationHandle(rootPath, candidatePath, options);
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}
