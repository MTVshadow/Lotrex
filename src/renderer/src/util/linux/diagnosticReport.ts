import * as os from "node:os";

import type { IMountEntry } from "./linuxMounts";

export interface IDiagnosticSystemInfo {
  distro?: string;
  kernel?: string;
  arch?: string;
  sessionType?: string;
  desktop?: string;
}

export interface IDiagnosticSteamInfo {
  installType?: "native" | "flatpak" | "snap" | "unknown";
  steamPath?: string;
  libraries?: string[];
  protonRuntime?: string;
  prefixPath?: string;
}

export interface IDiagnosticGameInfo {
  gameId?: string;
  gameName?: string;
  gamePath?: string;
  stagingPath?: string;
  deploymentMethod?: string;
}

export interface IDiagnosticReportOptions {
  system?: IDiagnosticSystemInfo;
  steam?: IDiagnosticSteamInfo;
  game?: IDiagnosticGameInfo;
  mounts?: IMountEntry[];
  issues?: Array<{ code: string; severity: string; message: string }>;
  userName?: string;
  homeDir?: string;
}

/**
 * Маскування конфіденційних даних у рядках: токенів, API-ключів, паролів.
 */
export function redactTokensAndSecrets(text: string): string {
  let result = text;
  // Маскування Nexus API ключів та загальних токенів
  result = result.replace(
    /([?&](?:api_?key|token|password|secret|auth)=)([^&\s]+)/gi,
    "$1[REDACTED]",
  );
  // Маскування Bearer токенів
  result = result.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]");
  // Маскування довгих hex/base64 токенів (довжиною від 32 символів)
  result = result.replace(/([A-Fa-f0-9]{32,64})/g, (match) => match.slice(0, 4) + "...[REDACTED]");
  return result;
}

/**
 * Маскування шляху користувача (/home/username -> ~ або <user>).
 */
export function redactUserPaths(
  targetPath: string | undefined,
  homeDir = os.homedir(),
  userName = os.userInfo?.()?.username || process.env.USER,
): string {
  if (!targetPath) return "";

  let result = targetPath;
  if (homeDir && result.startsWith(homeDir)) {
    result = "~" + result.slice(homeDir.length);
  }

  if (userName && userName.length > 2) {
    const userRegex = new RegExp(`(/home/)${userName}([/\\\\]|$)`, "g");
    result = result.replace(userRegex, "$1<user>$2");
  }

  return redactTokensAndSecrets(result);
}

/**
 * Визначення типу встановлення Steam за шляхом.
 */
export function inferSteamInstallType(
  steamPath?: string,
): "native" | "flatpak" | "snap" | "unknown" {
  if (!steamPath) return "unknown";
  if (steamPath.includes(".var/app/com.valvesoftware.Steam")) return "flatpak";
  if (steamPath.includes("/snap/steam/")) return "snap";
  return "native";
}

/**
 * Генерація безпечного для приватності діагностичного звіту у форматі Markdown.
 */
export function generateLinuxDiagnosticReport(options: IDiagnosticReportOptions = {}): string {
  const homeDir = options.homeDir ?? os.homedir();
  const userName = options.userName ?? (os.userInfo?.()?.username || process.env.USER);

  const clean = (val?: string) => redactUserPaths(val, homeDir, userName);

  const kernel = options.system?.kernel ?? os.release();
  const arch = options.system?.arch ?? os.arch();
  const sessionType = options.system?.sessionType ?? process.env.XDG_SESSION_TYPE ?? "unknown";
  const desktop = options.system?.desktop ?? process.env.XDG_CURRENT_DESKTOP ?? "unknown";

  const lines: string[] = [
    "# Vortex Linux Diagnostic Report",
    `*Generated on: ${new Date().toISOString()}*`,
    "",
    "## 1. System Environment",
    `- **Kernel:** ${kernel}`,
    `- **Architecture:** ${arch}`,
    `- **Session Type:** ${sessionType}`,
    `- **Desktop Environment:** ${desktop}`,
    "",
    "## 2. Steam & Proton Tooling",
    `- **Steam Type:** ${options.steam?.installType ?? inferSteamInstallType(options.steam?.steamPath)}`,
    `- **Steam Path:** ${clean(options.steam?.steamPath) || "Not resolved"}`,
    `- **Proton Runtime:** ${clean(options.steam?.protonRuntime) || "Not configured/detected"}`,
    `- **Proton Prefix:** ${clean(options.steam?.prefixPath) || "Not initialized"}`,
  ];

  if (options.steam?.libraries && options.steam.libraries.length > 0) {
    lines.push("- **Steam Libraries:**");
    for (const lib of options.steam.libraries) {
      lines.push(`  - \`${clean(lib)}\``);
    }
  }

  lines.push(
    "",
    "## 3. Active Game & Deployment",
    `- **Game ID:** ${options.game?.gameId ?? "None"}`,
    `- **Game Name:** ${options.game?.gameName ?? "None"}`,
    `- **Game Directory:** ${clean(options.game?.gamePath) || "Unknown"}`,
    `- **Staging Directory:** ${clean(options.game?.stagingPath) || "Unknown"}`,
    `- **Active Deployment Method:** ${options.game?.deploymentMethod ?? "Default"}`,
  );

  if (options.mounts && options.mounts.length > 0) {
    lines.push("", "## 4. Relevant Filesystem Mounts");
    for (const mount of options.mounts) {
      const opts = mount.options.join(", ");
      lines.push(`- \`${clean(mount.mountPoint)}\` (${mount.fsType}): [${opts}]`);
    }
  }

  if (options.issues && options.issues.length > 0) {
    lines.push("", "## 5. Detected Health & Configuration Issues");
    for (const issue of options.issues) {
      lines.push(`- **[${issue.severity.toUpperCase()}] ${issue.code}:** ${issue.message}`);
    }
  } else {
    lines.push("", "## 5. Detected Health & Configuration Issues", "- No active issues reported.");
  }

  return lines.join("\n");
}
