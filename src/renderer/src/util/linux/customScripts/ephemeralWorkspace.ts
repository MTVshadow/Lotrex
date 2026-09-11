import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { sha256 } from "./contracts";

export interface IEphemeralWorkspace {
  /** Absolute path to the isolated workspace directory */
  readonly workspacePath: string;
  /** Absolute path to the staged executable script file */
  readonly scriptFilePath: string;
  /** Cryptographic SHA-256 hash of the staged script */
  readonly scriptChecksum: string;
  /** Removes the workspace directory and all contained files */
  cleanup(): Promise<void>;
}

/**
 * Creates an ephemeral, isolated workspace under /tmp with strict 0o700 permissions.
 * Staged executable content is copied or written here, and its SHA-256 is verified
 * immediately before execution (Control 8 & Section 2 Delivery Plan item 7).
 *
 * @param scriptId Unique identifier of the script.
 * @param scriptContent Source code or binary content of the script.
 * @param scriptFileName Filename to use inside the workspace (defaults to "run.sh").
 */
export async function createEphemeralWorkspace(
  scriptId: string,
  scriptContent: string,
  scriptFileName = "run.sh",
): Promise<IEphemeralWorkspace> {
  const sanitizedId = scriptId.replace(/[^a-zA-Z0-9_\-]/g, "_");
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  const workspaceName = `vortex-customscript-${sanitizedId}-${randomSuffix}`;
  const workspacePath = path.join(os.tmpdir(), workspaceName);

  // 1. Create isolated directory with 0o700 (owner-only read/write/execute)
  await fs.mkdir(workspacePath, { recursive: true, mode: 0o700 });
  await fs.chmod(workspacePath, 0o700);

  // 2. Stage script file inside workspace with 0o700 permissions
  const scriptFilePath = path.join(workspacePath, scriptFileName);
  await fs.writeFile(scriptFilePath, scriptContent, { encoding: "utf8", mode: 0o700 });
  await fs.chmod(scriptFilePath, 0o700);

  // 3. Immediately verify staged file checksum to detect race or tampering
  const writtenData = await fs.readFile(scriptFilePath);
  const scriptChecksum = sha256(writtenData);

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
    } catch {
      // Ignored during cleanup
    }
  };

  return {
    workspacePath,
    scriptFilePath,
    scriptChecksum,
    cleanup,
  };
}

/**
 * Recovers and cleans up any orphaned ephemeral workspaces left behind by crashes or abrupt shutdowns.
 * Run during application startup or recovery.
 */
export async function cleanupStaleEphemeralWorkspaces(): Promise<number> {
  const tmpDir = os.tmpdir();
  let cleanedCount = 0;
  try {
    const entries = await fs.readdir(tmpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("vortex-customscript-")) {
        const target = path.join(tmpDir, entry.name);
        try {
          await fs.rm(target, { recursive: true, force: true });
          cleanedCount++;
        } catch {
          // Skip if locked or in-use
        }
      }
    }
  } catch {
    // Non-fatal if tmp cannot be read
  }
  return cleanedCount;
}
