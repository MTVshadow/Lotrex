import * as path from "node:path";

const CRITICAL_EXTENSIONS = new Set([
  ".appimage",
  ".bat",
  ".bin",
  ".cmd",
  ".com",
  ".cpl",
  ".dll",
  ".dylib",
  ".exe",
  ".fish",
  ".jar",
  ".js",
  ".mjs",
  ".cjs",
  ".msi",
  ".pl",
  ".ps1",
  ".py",
  ".rb",
  ".run",
  ".sh",
  ".so",
  ".vbs",
  ".zsh",
]);

export function isCriticalHardlinkDeploymentPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLocaleLowerCase("en-US");
  return CRITICAL_EXTENSIONS.has(path.posix.extname(normalized));
}

export class LinuxHardlinkCriticalFilesError extends Error {
  public readonly code = "ELINUXHARDLINKCRITICAL";

  constructor(public readonly files: string[]) {
    const preview = files.slice(0, 10);
    const remainder = files.length - preview.length;
    super(
      `Linux hardlink deployment was blocked before mutation because the plan contains ${files.length} executable or script file(s): ${preview.join(", ")}${remainder > 0 ? ` (and ${remainder} more)` : ""}. Switch this game to Symlink Deployment or remove the critical files from the deployment plan.`,
    );
    this.name = "LinuxHardlinkCriticalFilesError";
  }
}

export function assertLinuxHardlinkPlanSafe(
  deploymentMethodId: string,
  platform: NodeJS.Platform,
  relativePaths: string[],
): void {
  if (platform !== "linux" || deploymentMethodId !== "hardlink_activator") return;
  const blocked = relativePaths.filter(isCriticalHardlinkDeploymentPath).sort();
  if (blocked.length > 0) throw new LinuxHardlinkCriticalFilesError(blocked);
}
