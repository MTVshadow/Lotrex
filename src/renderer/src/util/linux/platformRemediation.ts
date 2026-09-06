/** Adapt shared remediation text to the current platform. */

export function sanitizePlatformMessage(
  text: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "linux" || !text) {
    return text;
  }

  let result = text;

  result = result.replace(
    /run(?:\s+\w+)?\s+as\s+administrator/gi,
    "verify folder permissions (chmod/chown)",
  );
  result = result.replace(/administrator\s+privileges/gi, "appropriate Linux user permissions");

  result = result.replace(
    /windows\s+defender(?:\s+exclusions?)?/gi,
    "Linux filesystem permissions or security policies",
  );
  result = result.replace(
    /antivirus\s+whitelist(?:ing)?/gi,
    "filesystem mount options and permissions",
  );

  result = result.replace(/same\s+drive(?:\s+letter)?/gi, "same filesystem partition");
  result = result.replace(/drive\s+letter/gi, "mount point");

  result = result.replace(/windows\s+registry/gi, "Wine prefix registry (user.reg)");

  return result;
}

export interface IRemediationAdvice {
  code: string;
  title: string;
  message: string;
  remediation: string;
  commandSnippet?: string;
}

/** Return structured, platform-appropriate remediation. */
export function getPlatformRemediation(
  issueCode: string,
  context: { path?: string; appId?: string } = {},
  platform: NodeJS.Platform = process.platform,
): IRemediationAdvice {
  if (platform !== "linux") {
    return {
      code: issueCode,
      title: "File access issue",
      message: "An issue occurred accessing the file or folder.",
      remediation: "Ensure you have administrator permissions and check your antivirus settings.",
    };
  }

  switch (issueCode) {
    case "permission-denied":
    case "EACCES":
    case "EPERM":
      return {
        code: issueCode,
        title: "Directory access error",
        message: `Vortex cannot write to: ${context.path || "the selected path"}`,
        remediation:
          "Review the directory ownership and permissions. Do not run Vortex through sudo.",
      };

    case "cross-device-hardlink":
    case "EXDEV":
      return {
        code: issueCode,
        title: "Filesystem device mismatch",
        message: "The staging directory and game are on different filesystem mount points.",
        remediation:
          "Linux hardlinks work only within one filesystem. Move staging to the game filesystem or select Symlink Deployment.",
      };

    case "antivirus-blocked":
      return {
        code: issueCode,
        title: "Executable access blocked",
        message:
          "The filesystem does not allow execution, or the file is missing executable permission (+x).",
        remediation:
          "Review the mount's 'noexec' option and the file permissions before making changes.",
      };

    default:
      return {
        code: issueCode,
        title: "Diagnostic message",
        message: `A system event was detected: ${issueCode}`,
        remediation: "Review the Vortex logs for details.",
      };
  }
}
