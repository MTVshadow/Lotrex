import * as path from "node:path";

import { getErrorCode } from "@vortex/shared";

import * as fs from "../fs";

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
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
