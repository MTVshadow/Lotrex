import * as fs from "node:fs";
import * as path from "node:path";

export interface IFlatpakPermissionIssue {
  code: "flatpak-permission-missing";
  severity: "error" | "warning";
  targetPath: string;
  command: string;
  flatsealAdvice: string;
  message: string;
}

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
export function getFlatpakOverrideCommand(
  targetDir: string,
  appId = "com.valvesoftware.Steam",
): string {
  const normalized = path.resolve(targetDir);
  return `flatpak override --user --filesystem="${normalized}" ${appId}`;
}

/**
 * Оцінка доступу до каталогу бібліотеки Steam або дисків з урахуванням обмежень пісочниці Flatpak.
 */
export function assessFlatpakDirectoryAccess(
  targetDir: string,
  steamPath?: string,
): IFlatpakPermissionIssue | undefined {
  const isFlatpak = isFlatpakSteam(steamPath) || isVortexInFlatpak();
  if (!isFlatpak) {
    return undefined;
  }

  const normalized = path.resolve(targetDir);

  // Перевіряємо, чи доступний каталог на читання та запис
  let hasAccess = false;
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
    const command = getFlatpakOverrideCommand(normalized);
    return {
      code: "flatpak-permission-missing",
      severity: "error",
      targetPath: normalized,
      command,
      flatsealAdvice: `У Flatseal оберіть 'Steam' -> розділ 'Filesystem' -> 'Other files' та додайте шлях: ${normalized}`,
      message: `Flatpak Steam не має доступу до зовнішнього каталогу: ${normalized}. Необхідно надати дозвіл у пісочниці.`,
    };
  }

  return undefined;
}
