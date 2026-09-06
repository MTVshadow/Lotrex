import * as fs from "node:fs";
import * as path from "node:path";

export interface IFlatpakPermissionIssue {
  appId: string;
  code: "flatpak-permission-missing";
  severity: "error" | "warning";
  targetPath: string;
  command: string;
  flatsealAdvice: string;
  message: string;
}

const STEAM_FLATPAK_ID = "com.valvesoftware.Steam";
const VORTEX_FLATPAK_ID = "com.nexusmods.vortex";

/**
 * Перевірка, чи запущено сам Vortex усередині пісочниці Flatpak.
 */
export function isVortexInFlatpak(): boolean {
  return fs.existsSync("/.flatpak-info") || Boolean(process.env.FLATPAK_ID);
}

/**
 * Перевірка, чи належить шлях інсталяції Steam до Flatpak-версії Steam.
 */
export function isFlatpakSteam(steamPath?: string): boolean {
  if (!steamPath) return false;
  return steamPath.includes(".var/app/com.valvesoftware.Steam");
}

/**
 * Генерація точної мінімальної команди 'flatpak override' для надання доступу до конкретної директорії.
 * Ми не рекомендуємо надмірні права на кшталт --filesystem=host або --filesystem=home.
 */
export function getFlatpakOverrideCommand(targetDir: string, appId = STEAM_FLATPAK_ID): string {
  const normalized = path.resolve(targetDir);
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  return `flatpak override --user --filesystem=${quote(normalized)} ${quote(appId)}`;
}

export function flatpakAccessAppId(steamPath?: string): string | undefined {
  if (isVortexInFlatpak()) {
    return process.env.FLATPAK_ID || VORTEX_FLATPAK_ID;
  }
  return isFlatpakSteam(steamPath) ? STEAM_FLATPAK_ID : undefined;
}

/**
 * Оцінка доступу до каталогу бібліотеки Steam або дисків з урахуванням обмежень пісочниці Flatpak.
 */
export function assessFlatpakDirectoryAccess(
  targetDir: string,
  steamPath?: string,
): IFlatpakPermissionIssue | undefined {
  const appId = flatpakAccessAppId(steamPath);
  if (!appId) {
    return undefined;
  }

  const normalized = path.resolve(targetDir);

  // Перевіряємо, чи доступний каталог на читання та запис
  let hasAccess: boolean;
  try {
    let checkPath = normalized;
    while (!fs.existsSync(checkPath) && checkPath !== path.dirname(checkPath)) {
      checkPath = path.dirname(checkPath);
    }
    fs.accessSync(checkPath, fs.constants.R_OK | fs.constants.W_OK);
    hasAccess = true;
  } catch {
    hasAccess = false;
  }

  if (!hasAccess) {
    const command = getFlatpakOverrideCommand(normalized, appId);
    return {
      appId,
      code: "flatpak-permission-missing",
      severity: "error",
      targetPath: normalized,
      command,
      flatsealAdvice: `In Flatseal, select '${appId}', open 'Filesystem' -> 'Other files', and add: ${normalized}`,
      message: `The Flatpak sandbox '${appId}' cannot access: ${normalized}`,
    };
  }

  return undefined;
}
