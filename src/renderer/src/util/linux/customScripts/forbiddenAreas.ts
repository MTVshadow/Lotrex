import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ForbiddenHostAreaError,
  PermissionBoundaryError,
  PrefixBoundaryError,
  PrivilegeEscalationForbiddenError,
} from "./contracts";

/**
 * Commands and binaries used for privilege escalation that custom scripts are strictly
 * forbidden to invoke. Enforces Control 13 (No sudo password handling).
 */
const PRIVILEGE_ESCALATION_BINARIES = new Set([
  "sudo",
  "pkexec",
  "doas",
  "su",
  "gksu",
  "kdesu",
  "runas",
]);

/**
 * System root directories that must never be targeted or resolved as readable or writable roots.
 */
const SYSTEM_DIRECTORIES = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
];

/**
 * Sensitive user directory patterns (credentials, crypto keys, browser state).
 */
function getSensitiveUserPatterns(home: string): string[] {
  return [
    path.join(home, ".ssh"),
    path.join(home, ".gnupg"),
    path.join(home, ".local", "share", "keyrings"),
    path.join(home, ".config", "secret-service"),
    path.join(home, ".authinfo"),
    path.join(home, ".password-store"),
    path.join(home, ".aws"),
    path.join(home, ".docker"),
    path.join(home, ".mozilla"),
    path.join(home, ".config", "google-chrome"),
    path.join(home, ".config", "chromium"),
    path.join(home, ".config", "BraveSoftware"),
    path.join(home, ".config", "microsoft-edge"),
  ];
}

/**
 * Verifies that the interpreter, argument array, or raw script content does not invoke
 * privilege escalation utilities (sudo, pkexec, doas, su). Enforces Control 13.
 */
export function assertNoPrivilegeEscalation(
  interpreter: string,
  args: string[] = [],
  scriptContent?: string,
): void {
  const interpBase = path.basename(interpreter).toLowerCase();
  if (PRIVILEGE_ESCALATION_BINARIES.has(interpBase)) {
    throw new PrivilegeEscalationForbiddenError(interpreter);
  }

  for (const arg of args) {
    const trimmed = arg.trim().toLowerCase();
    const firstWord = trimmed.split(/\s+/)[0];
    const baseWord = path.basename(firstWord);
    if (PRIVILEGE_ESCALATION_BINARIES.has(baseWord)) {
      throw new PrivilegeEscalationForbiddenError(arg);
    }
  }

  if (scriptContent) {
    // Check for escalation commands at word boundaries in the script content
    const escalationRegex = /\b(sudo|pkexec|doas|su|gksu|kdesu|runas)\b/i;
    const match = escalationRegex.exec(scriptContent);
    if (match) {
      throw new PrivilegeEscalationForbiddenError(match[0]);
    }
  }
}

/**
 * Resolves a path to its canonical realpath on the physical filesystem.
 * If the leaf file does not yet exist, recursively canonicalizes the closest existing ancestor
 * and rejoins the remaining relative components, neutralizing symlink redirections.
 */
export function getCanonicalPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  try {
    return fs.realpathSync(resolved);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      const parent = path.dirname(resolved);
      if (parent === resolved) {
        return resolved;
      }
      const canonicalParent = getCanonicalPath(parent);
      return path.join(canonicalParent, path.basename(resolved));
    }
    return resolved;
  }
}

/**
 * Lexical and physical containment check: returns true if candidate is inside root or identical.
 */
export function isWithinBoundary(rootPath: string, candidatePath: string): boolean {
  const rel = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== "..");
}

/**
 * Verifies that a path does not target forbidden host areas (Control 3).
 * Resolves symlinks, bind mounts, and canonical paths before checking.
 *
 * @param candidatePath Path to validate.
 * @param allowedWorkspace Optional temporary workspace directory granted execution access.
 */
export function assertPathNotForbidden(candidatePath: string, allowedWorkspace?: string): void {
  const canonical = getCanonicalPath(candidatePath);
  const home = os.homedir();

  // If candidate is inside the authorized ephemeral workspace, allow it
  if (allowedWorkspace && isWithinBoundary(allowedWorkspace, canonical)) {
    return;
  }

  // 1. Root filesystem escape check
  if (canonical === "/") {
    throw new ForbiddenHostAreaError("Refusing access to the root filesystem ('/')", candidatePath);
  }

  // 2. Whole home directory escape check
  if (home && canonical === path.resolve(home)) {
    throw new ForbiddenHostAreaError(
      "Refusing access to the entire user home directory without subpath",
      candidatePath,
    );
  }

  // 3. System directories check
  for (const sysDir of SYSTEM_DIRECTORIES) {
    if (canonical === sysDir || isWithinBoundary(sysDir, canonical)) {
      throw new ForbiddenHostAreaError(
        `Refusing access to protected system location: ${sysDir}`,
        candidatePath,
      );
    }
  }

  // 4. Sensitive user directories (SSH, GPG, keyrings, browsers)
  if (home) {
    const sensitive = getSensitiveUserPatterns(home);
    for (const sensDir of sensitive) {
      if (canonical === sensDir || isWithinBoundary(sensDir, canonical)) {
        throw new ForbiddenHostAreaError(
          `Refusing access to protected credential/security directory: ${sensDir}`,
          candidatePath,
        );
      }
    }
  }

  // 5. Wine dosdevices drive escape check (e.g. z:\ or dosdevices/z: mapped to root)
  const lowerCanonical = canonical.toLowerCase();
  if (
    lowerCanonical.includes("dosdevices/z:") ||
    lowerCanonical.startsWith("z:") ||
    lowerCanonical.startsWith("z:\\")
  ) {
    throw new ForbiddenHostAreaError(
      "Refusing access through Wine host drive mapping (Z:)",
      candidatePath,
    );
  }
}

/**
 * Verifies that candidatePath falls strictly within at least one of the declared allowed roots.
 * Enforces Control 2 (Minimum filesystem permissions).
 */
export function assertPathWithinDeclaredRoots(
  candidatePath: string,
  allowedRoots: string[],
  accessType: "read" | "write" = "read",
): void {
  const canonicalCandidate = getCanonicalPath(candidatePath);

  for (const root of allowedRoots) {
    const canonicalRoot = getCanonicalPath(root);
    if (isWithinBoundary(canonicalRoot, canonicalCandidate)) {
      return;
    }
  }

  throw new PermissionBoundaryError(
    `Undeclared ${accessType} access to path outside declared roots: ${candidatePath}`,
    candidatePath,
  );
}

/**
 * Verifies Proton/Wine prefix boundary isolation (Control 6).
 * Ensures that if a prefix is configured, access does not cross into another prefix or escape through Wine drives.
 */
export function assertPrefixIsolation(candidatePath: string, configuredPrefix?: string): void {
  if (!configuredPrefix) return;

  const canonical = getCanonicalPath(candidatePath);
  const canonicalPrefix = getCanonicalPath(configuredPrefix);

  // Check for Wine drive mapping escape
  const lower = candidatePath.toLowerCase();
  if (lower.includes("/dosdevices/z:") || lower.includes("\\dosdevices\\z:")) {
    throw new PrefixBoundaryError(
      "Attempted Wine prefix escape via dosdevices/z: mapping",
      candidatePath,
    );
  }

  // If candidate refers to another pfx or compatdata directory outside configured prefix
  if (
    (lower.includes("/compatdata/") || lower.includes("/pfx/")) &&
    !isWithinBoundary(canonicalPrefix, canonical)
  ) {
    throw new PrefixBoundaryError(
      `Cross-prefix access is strictly prohibited. Path ${candidatePath} does not belong to configured prefix ${configuredPrefix}`,
      candidatePath,
    );
  }
}
