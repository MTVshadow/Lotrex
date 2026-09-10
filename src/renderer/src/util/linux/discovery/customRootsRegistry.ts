import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { IBoundedSourceDescriptor } from "./boundedSources";
import { resolvePhysicalPath } from "./canonicalization";

export type CustomRootScope = "all" | "launcher" | "library" | "modding-tool" | "game";

export interface IUserApprovedCustomRoot {
  id: string;
  path: string;
  scope: CustomRootScope;
  label?: string;
  createdAt: number;
  validated: boolean;
  validationError?: string;
}

export interface ICustomRootValidationResult {
  isValid: boolean;
  normalizedPath: string;
  error?: string;
}

/**
 * Validates a user-submitted candidate root path (Phase 8).
 *
 * Educational comment:
 * Validates user-supplied custom directories:
 * 1. Path must be absolute.
 * 2. Prohibits system root '/' or user home directory directly (unbounded disk crawl prevention).
 * 3. Target directory must exist and be readable.
 * 4. Prevents duplicate registrations against existing custom roots.
 */
export function validateCustomRootCandidate(
  candidatePath: string,
  existingRoots: IUserApprovedCustomRoot[] = [],
): ICustomRootValidationResult {
  if (!candidatePath || candidatePath.trim().length === 0) {
    return {
      isValid: false,
      normalizedPath: "",
      error: "Path cannot be empty",
    };
  }

  const normalized = path.resolve(candidatePath.trim());

  if (!normalized.startsWith("/")) {
    return {
      isValid: false,
      normalizedPath: normalized,
      error: "Path must be an absolute filesystem path starting with '/'",
    };
  }

  // Unbounded crawl protection: forbid root '/' or user home directory
  const homeDir = os.homedir();
  if (normalized === "/" || normalized === homeDir) {
    return {
      isValid: false,
      normalizedPath: normalized,
      error: `Adding system root '/' or home directory '${homeDir}' directly as a custom root is strictly prohibited.`,
    };
  }

  // Check directory existence and permissions
  try {
    const stat = fs.statSync(normalized);
    if (!stat.isDirectory()) {
      return {
        isValid: false,
        normalizedPath: normalized,
        error: `Target path exists but is not a directory: ${normalized}`,
      };
    }
  } catch {
    return {
      isValid: false,
      normalizedPath: normalized,
      error: `Directory does not exist or is not accessible: ${normalized}`,
    };
  }

  try {
    fs.accessSync(normalized, fs.constants.R_OK);
  } catch {
    return {
      isValid: false,
      normalizedPath: normalized,
      error: `Read permission denied for directory: ${normalized}`,
    };
  }

  // Prevent duplicate roots pointing to the same physical path
  const candidatePhysical = resolvePhysicalPath(normalized);
  const isDuplicate = existingRoots.some(
    (root) => resolvePhysicalPath(root.path) === candidatePhysical,
  );
  if (isDuplicate) {
    return {
      isValid: false,
      normalizedPath: normalized,
      error: `A custom root pointing to this physical directory already exists: ${normalized}`,
    };
  }

  return {
    isValid: true,
    normalizedPath: normalized,
  };
}

/**
 * Registry of user-approved discovery roots (Phase 8).
 *
 * Educational comment:
 * Manages user-defined search roots with distinct scopes, labels, and validation state.
 * Manual roots augment automatic discovery and are not silently rewritten.
 */
export class CustomRootsRegistry {
  private mRoots: Map<string, IUserApprovedCustomRoot> = new Map();

  constructor(initialRoots: IUserApprovedCustomRoot[] = []) {
    for (const root of initialRoots) {
      this.mRoots.set(root.id, { ...root });
    }
  }

  public getRoots(): IUserApprovedCustomRoot[] {
    return Array.from(this.mRoots.values());
  }

  public getRootById(id: string): IUserApprovedCustomRoot | undefined {
    return this.mRoots.get(id);
  }

  public addRoot(
    rawPath: string,
    scope: CustomRootScope = "all",
    label?: string,
  ): IUserApprovedCustomRoot {
    const existing = this.getRoots();
    const validation = validateCustomRootCandidate(rawPath, existing);

    if (!validation.isValid) {
      throw new Error(validation.error || "Invalid custom root path");
    }

    const normPath = validation.normalizedPath;
    const hash = crypto.createHash("sha256").update(normPath).digest("hex").slice(0, 12);
    const id = `custom-root:${hash}`;

    const newRoot: IUserApprovedCustomRoot = {
      id,
      path: normPath,
      scope,
      label: label?.trim() || path.basename(normPath),
      createdAt: Date.now(),
      validated: true,
    };

    this.mRoots.set(id, newRoot);
    return newRoot;
  }

  public removeRoot(idOrPath: string): boolean {
    if (this.mRoots.has(idOrPath)) {
      return this.mRoots.delete(idOrPath);
    }

    const normPath = path.resolve(idOrPath);
    for (const [id, root] of this.mRoots.entries()) {
      if (path.resolve(root.path) === normPath) {
        return this.mRoots.delete(id);
      }
    }

    return false;
  }

  public resetRoots(): void {
    this.mRoots.clear();
  }

  /**
   * Converts custom roots into bounded source descriptors for engine consumption.
   */
  public toBoundedSources(): IBoundedSourceDescriptor[] {
    return this.getRoots().map((root) => ({
      id: root.id,
      category: "user-approved-root",
      provider: "custom-root",
      resolvedPath: root.path,
      packagingFormat: "native",
      exists: fs.existsSync(root.path),
    }));
  }
}
