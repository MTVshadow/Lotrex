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

export interface IParentIdentity {
  dev: number;
  ino: number;
}

export interface IDestinationSafetyOptions {
  platform?: NodeJS.Platform;
  expectedParentIdentity?: IParentIdentity;
}

/**
 * Validates deployment destination parent identity and root containment immediately before write/mutation.
 * Defends against TOCTOU race conditions where a parent directory could be replaced with a symlink
 * or swapped with an attacker-controlled directory between planning and disk mutation.
 *
 * Checks:
 * 1. Allowed-root containment (isWithinRoot) for candidatePath and its parent directory.
 * 2. Entire ancestor hierarchy below rootPath contains no symbolic links.
 * 3. Parent directory must exist, be an actual directory (not symlink).
 * 4. If expectedParentIdentity is provided, verifies that (dev, ino) match to detect directory swapping races.
 * 5. If target path already exists, blocks special POSIX device files (FIFO/socket/dev) and escaping symlinks.
 *
 * Educational note:
 * In POSIX systems, a Time-of-Check to Time-of-Use (TOCTOU) vulnerability can occur if an unprivileged or concurrent
 * process replaces an inspected directory with a symbolic link before Vortex creates or modifies files. By validating
 * the parent directory's device and inode immediately before performing link/unlink/write operations, we ensure
 * the file is strictly created within the intended, validated physical directory container.
 *
 * Returns the verified parent identity { dev, ino } to allow the caller to re-verify at subsequent mutation boundaries.
 */
export async function assertLinuxDestinationSafety(
  rootPath: string,
  candidatePath: string,
  optionsOrExpected?: IDestinationSafetyOptions | IParentIdentity,
  platformOverride?: NodeJS.Platform,
): Promise<IParentIdentity | undefined> {
  const expectedIdentity: IParentIdentity | undefined =
    optionsOrExpected && "ino" in optionsOrExpected && "dev" in optionsOrExpected
      ? optionsOrExpected
      : (optionsOrExpected as IDestinationSafetyOptions)?.expectedParentIdentity;

  const platform =
    platformOverride ??
    (optionsOrExpected && "platform" in optionsOrExpected
      ? (optionsOrExpected as IDestinationSafetyOptions).platform
      : undefined) ??
    process.platform;

  if (platform !== "linux") return undefined;

  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(resolvedRoot, candidatePath);
  const resolvedParent = path.dirname(resolvedCandidate);

  // 1. Allowed-root containment check
  if (
    !isWithinRoot(resolvedRoot, resolvedCandidate) ||
    !isWithinRoot(resolvedRoot, resolvedParent)
  ) {
    const err = new Error(`Refusing to mutate path outside its managed root: ${resolvedCandidate}`);
    err["code"] = "EDEPLOYMENTOUTSIDEROOT";
    err["path"] = resolvedCandidate;
    throw err;
  }

  // 2. Ancestor hierarchy symlink traversal check
  await assertLinuxPathHasNoSymlinkAncestors(resolvedRoot, resolvedCandidate, platform);

  // 3. Parent directory inspection and identity verification (TOCTOU race protection)
  let parentStats: fs.Stats;
  try {
    parentStats = await fs.lstatAsync(resolvedParent);
  } catch (err: unknown) {
    if (getErrorCode(err) === "ENOENT") {
      if (expectedIdentity !== undefined) {
        const raceErr = new Error(
          `Deployment destination parent directory disappeared before mutation: ${resolvedParent}`,
        );
        raceErr["code"] = "EDEPLOYMENTPARENTCHANGED";
        raceErr["path"] = resolvedParent;
        throw raceErr;
      }
      return undefined;
    }
    throw err;
  }

  if (parentStats.isSymbolicLink()) {
    const err = new Error(
      `Refusing to mutate file under symbolic link parent directory: ${resolvedParent}`,
    );
    err["code"] = "EDEPLOYMENTSYMLINK";
    err["path"] = resolvedParent;
    throw err;
  }

  if (!parentStats.isDirectory()) {
    const err = new Error(`Deployment destination parent is not a directory: ${resolvedParent}`);
    err["code"] = "ENOTDIR";
    err["path"] = resolvedParent;
    throw err;
  }

  if (expectedIdentity !== undefined) {
    if (parentStats.dev !== expectedIdentity.dev || parentStats.ino !== expectedIdentity.ino) {
      const err = new Error(
        `Destination parent directory identity changed before write (TOCTOU race detected): ${resolvedParent} (expected ino ${expectedIdentity.ino}, got ${parentStats.ino})`,
      );
      err["code"] = "EDEPLOYMENTPARENTCHANGED";
      err["path"] = resolvedParent;
      err["expected"] = expectedIdentity;
      err["actual"] = { dev: parentStats.dev, ino: parentStats.ino };
      throw err;
    }
  }

  // 4. Target leaf inspection if already on disk
  try {
    const leafStats = await fs.lstatAsync(resolvedCandidate);
    if (
      leafStats.isFIFO() ||
      leafStats.isSocket() ||
      leafStats.isCharacterDevice() ||
      leafStats.isBlockDevice()
    ) {
      const deviceType = leafStats.isFIFO()
        ? "fifo"
        : leafStats.isSocket()
          ? "socket"
          : leafStats.isCharacterDevice()
            ? "character_device"
            : "block_device";
      const err = new Error(
        `Refusing to mutate special POSIX device file at destination: ${resolvedCandidate} (${deviceType})`,
      );
      err["code"] = "EDEPLOYMENTSPECIALDEVICE";
      err["path"] = resolvedCandidate;
      err["deviceType"] = deviceType;
      throw err;
    }

    if (leafStats.isSymbolicLink()) {
      const linkTarget = await fs.readlinkAsync(resolvedCandidate);
      const resolvedTarget = path.resolve(resolvedParent, linkTarget);
      if (!isWithinRoot(resolvedRoot, resolvedTarget)) {
        const err = new Error(
          `Refusing to overwrite destination through hostile symbolic link pointing outside root: ${resolvedCandidate} -> ${resolvedTarget}`,
        );
        err["code"] = "EDEPLOYMENTSYMLINK";
        err["path"] = resolvedCandidate;
        throw err;
      }
    }
  } catch (err: unknown) {
    if (getErrorCode(err) !== "ENOENT") {
      throw err;
    }
  }

  return { dev: parentStats.dev, ino: parentStats.ino };
}
