import * as path from "node:path";

import { getErrorCode } from "@vortex/shared";

import * as fs from "../fs";
import { assertLinuxPathLimits } from "./pathLimits";

/**
 * Checks whether candidatePath is lexically contained within rootPath or identical to it.
 * Rejects parent directory traversal (e.g. "../") and root escapes.
 */
export function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/**
 * Reject paths whose existing parent chain contains a symbolic link below the managed root.
 * The root itself is intentionally allowed to be a link because Steam library and Data paths are
 * commonly configured through user-owned symlinks; trust in the configured root is established by
 * the caller, while descendants are untrusted deployment input.
 */
export async function assertLinuxPathHasNoSymlinkAncestors(
  rootPath: string,
  candidatePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== "linux") return;
  if (!isWithinRoot(rootPath, candidatePath)) {
    const err = new Error(`Refusing to access a path outside its managed root: ${candidatePath}`);
    err["code"] = "EDEPLOYMENTOUTSIDEROOT";
    err["path"] = candidatePath;
    throw err;
  }

  const relativeParent = path.relative(
    path.resolve(rootPath),
    path.dirname(path.resolve(candidatePath)),
  );
  if (relativeParent === "") return;

  let currentPath = path.resolve(rootPath);
  for (const component of relativeParent.split(path.sep)) {
    currentPath = path.join(currentPath, component);
    try {
      const stats = await fs.lstatAsync(currentPath);
      if (stats.isSymbolicLink()) {
        const err = new Error(
          `Refusing to follow a symbolic-link directory inside a managed root: ${currentPath}`,
        );
        err["code"] = "EDEPLOYMENTSYMLINK";
        err["path"] = currentPath;
        throw err;
      }
      if (!stats.isDirectory()) {
        const err = new Error(`A deployment path parent is not a directory: ${currentPath}`);
        err["code"] = "ENOTDIR";
        err["path"] = currentPath;
        throw err;
      }
    } catch (err: unknown) {
      if (getErrorCode(err) === "ENOENT") return;
      throw err;
    }
  }
}

export interface ISymlinkPreflightOptions {
  platform?: NodeJS.Platform;
}

/**
 * Preflight check for extraction destinations to prevent symlink-based arbitrary file overwrites
 * (Zip-slip and hostile symlink traversal attacks).
 *
 * Validates that:
 * 1. The target path does not lexically or logically escape destinationRoot.
 * 2. Linux path limits are satisfied for all destination paths (255 UTF-8 bytes component / 4096 bytes total).
 * 3. No ancestor directory in the path hierarchy is a symbolic link escaping or redirecting outside root.
 * 4. Any existing link at the target destination does not point outside destinationRoot.
 * 5. Broken symlinks and recursive symlink loops are detected and rejected.
 */
export async function assertLinuxExtractionSafety(
  destinationRoot: string,
  plannedPaths: Iterable<string>,
  options: ISymlinkPreflightOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") return;

  const resolvedRoot = path.resolve(destinationRoot);

  for (const candidate of plannedPaths) {
    const resolvedCandidate = path.resolve(resolvedRoot, candidate);

    // 1. Lexical escape check (Zip-Slip defense)
    if (!isWithinRoot(resolvedRoot, resolvedCandidate)) {
      const err = new Error(
        `Refusing to extract file outside destination root: ${candidate} (resolved: ${resolvedCandidate})`,
      );
      err["code"] = "EDEPLOYMENTOUTSIDEROOT";
      err["path"] = resolvedCandidate;
      throw err;
    }

    // 2. Linux path limits check (255-byte name / 4096-byte path)
    assertLinuxPathLimits([resolvedCandidate], platform);

    // 3. Ancestor symlink traversal check
    await assertLinuxPathHasNoSymlinkAncestors(resolvedRoot, resolvedCandidate, platform);

    // 4. Target leaf inspection if already on disk
    try {
      const stats = await fs.lstatAsync(resolvedCandidate);

      // Block special POSIX device files (FIFO / named pipe, socket, character/block device)
      // to avoid infinite hangs on pipe reads or hardware device interactions
      if (
        stats.isFIFO() ||
        stats.isSocket() ||
        stats.isCharacterDevice() ||
        stats.isBlockDevice()
      ) {
        const deviceType = stats.isFIFO()
          ? "fifo"
          : stats.isSocket()
            ? "socket"
            : stats.isCharacterDevice()
              ? "character_device"
              : "block_device";
        const err = new Error(
          `Refusing to access special POSIX device file at destination: ${resolvedCandidate} (${deviceType})`,
        );
        err["code"] = "EDEPLOYMENTSPECIALDEVICE";
        err["path"] = resolvedCandidate;
        err["deviceType"] = deviceType;
        throw err;
      }

      if (stats.isSymbolicLink()) {
        const linkTarget = await fs.readlinkAsync(resolvedCandidate);
        const resolvedTarget = path.resolve(path.dirname(resolvedCandidate), linkTarget);

        if (!isWithinRoot(resolvedRoot, resolvedTarget)) {
          const err = new Error(
            `Refusing to overwrite destination through hostile symbolic link pointing outside root: ${resolvedCandidate} -> ${resolvedTarget}`,
          );
          err["code"] = "EDEPLOYMENTSYMLINK";
          err["path"] = resolvedCandidate;
          throw err;
        }

        // Verify that the link is not dangling or a loop
        try {
          await fs.statAsync(resolvedCandidate);
        } catch (statErr: unknown) {
          const code = getErrorCode(statErr);
          if (code === "ENOENT" || code === "ELOOP") {
            const err = new Error(
              `Broken symbolic link or loop detected at extraction destination: ${resolvedCandidate}`,
            );
            err["code"] = "EDEPLOYMENTBROKENSYMLINK";
            err["path"] = resolvedCandidate;
            throw err;
          }
          throw statErr;
        }
      }
    } catch (lstatErr: unknown) {
      if (getErrorCode(lstatErr) === "ENOENT") {
        // Destination does not exist yet - completely safe
        continue;
      }
      throw lstatErr;
    }
  }
}
