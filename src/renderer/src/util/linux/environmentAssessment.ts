import { assessFlatpakDirectoryAccess } from "./flatpakSupport";
import {
  assessDirectoryFileSystem,
  checkAvailableDiskSpace,
  checkHardlinkCompatibility,
  checkSymlinkCompatibility,
  type FileSystemIssueCode,
  type IMountEntry,
} from "./linuxMounts";

export type LinuxEnvironmentIssueCode = FileSystemIssueCode | "flatpak-permission-missing";

export type LinuxEnvironmentPathPurpose = "deployment" | "game" | "prefix" | "staging";

export interface ILinuxEnvironmentIssue {
  appId?: string;
  availableBytes?: number;
  code: LinuxEnvironmentIssueCode;
  command?: string;
  message: string;
  purpose: LinuxEnvironmentPathPurpose;
  severity: "error" | "warning";
  path: string;
  remediation?: string;
  requiredBytes?: number;
  fsType?: string;
  mountPoint?: string;
}

export interface ILinuxEnvironmentAssessmentInput {
  deploymentMethodId?: string;
  deploymentPaths?: string[];
  gamePath?: string;
  mounts?: IMountEntry[];
  platform: NodeJS.Platform;
  prefixPath?: string;
  requiredBytesByDeploymentPath?: Record<string, number>;
  stagingPath?: string;
  steamPath?: string;
}

export interface ILinuxEnvironmentAssessmentResult {
  blocking: boolean;
  issues: ILinuxEnvironmentIssue[];
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  return Array.from(new Set(paths.filter((entry): entry is string => Boolean(entry))));
}

function addDirectoryIssues(
  issues: ILinuxEnvironmentIssue[],
  targetPath: string,
  purpose: LinuxEnvironmentPathPurpose,
  mounts?: IMountEntry[],
): void {
  const fileSystemPurpose = purpose === "deployment" ? "game" : purpose;
  for (const issue of assessDirectoryFileSystem(targetPath, fileSystemPurpose, mounts)) {
    issues.push({ ...issue, purpose });
  }
}

function addFlatpakIssue(
  issues: ILinuxEnvironmentIssue[],
  targetPath: string,
  purpose: LinuxEnvironmentPathPurpose,
  steamPath?: string,
): void {
  const issue = assessFlatpakDirectoryAccess(targetPath, steamPath);
  if (issue !== undefined) {
    issues.push({
      appId: issue.appId,
      code: issue.code,
      command: issue.command,
      message: issue.message,
      path: issue.targetPath,
      purpose,
      remediation: `${issue.flatsealAdvice}\n${issue.command}`,
      severity: issue.severity,
    });
  }
}

export function assessLinuxEnvironment(
  input: ILinuxEnvironmentAssessmentInput,
): ILinuxEnvironmentAssessmentResult {
  if (input.platform !== "linux") {
    return { blocking: false, issues: [] };
  }

  const issues: ILinuxEnvironmentIssue[] = [];
  const deploymentPaths = uniquePaths(input.deploymentPaths ?? []);

  if (input.gamePath) {
    addDirectoryIssues(issues, input.gamePath, "game", input.mounts);
    addFlatpakIssue(issues, input.gamePath, "game", input.steamPath);
  }
  if (input.stagingPath) {
    addDirectoryIssues(issues, input.stagingPath, "staging", input.mounts);
    addFlatpakIssue(issues, input.stagingPath, "staging", input.steamPath);
  }
  if (input.prefixPath) {
    addDirectoryIssues(issues, input.prefixPath, "prefix", input.mounts);
  }

  for (const deploymentPath of deploymentPaths) {
    addDirectoryIssues(issues, deploymentPath, "deployment", input.mounts);
    addFlatpakIssue(issues, deploymentPath, "deployment", input.steamPath);

    const requiredBytes = input.requiredBytesByDeploymentPath?.[deploymentPath];
    if (requiredBytes !== undefined) {
      const issue = checkAvailableDiskSpace(deploymentPath, requiredBytes);
      if (issue !== undefined) {
        issues.push({ ...issue, purpose: "deployment" });
      }
    }

    if (input.deploymentMethodId === "hardlink_activator" && input.stagingPath) {
      const issue = checkHardlinkCompatibility(input.stagingPath, deploymentPath);
      if (issue !== undefined) {
        issues.push({ ...issue, purpose: "deployment" });
      }
    }
    if (input.deploymentMethodId?.includes("symlink")) {
      const issue = checkSymlinkCompatibility(deploymentPath);
      if (issue !== undefined) {
        issues.push({ ...issue, purpose: "deployment" });
      }
    }
  }

  const deduplicated = Array.from(
    new Map(
      issues.map((issue) => [`${issue.code}:${issue.purpose}:${issue.path}`, issue]),
    ).values(),
  );

  return {
    blocking: deduplicated.some((issue) => issue.severity === "error"),
    issues: deduplicated,
  };
}
