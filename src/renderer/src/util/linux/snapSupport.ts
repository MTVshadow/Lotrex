import * as fs from "node:fs";
import * as path from "node:path";

export interface ISnapPermissionIssue {
  appId: string;
  code: "snap-permission-missing";
  severity: "error" | "warning";
  targetPath: string;
  command: string;
  snapAdvice: string;
  message: string;
}

const STEAM_SNAP_ID = "steam";
const VORTEX_SNAP_ID = "vortex";

/**
 * Перевірка, чи запущено сам процес Vortex усередині пісочниці Snap.
 * Snap встановлює специфічні змінні оточення: SNAP, SNAP_NAME, SNAP_REVISION.
 */
export function isVortexInSnap(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SNAP || env.SNAP_NAME);
}

/**
 * Перевірка, чи належить шлях Steam до Snap-версії Steam.
 * Типові шляхи Snap Steam:
 * - ~/snap/steam/common/.local/share/Steam
 * - ~/snap/steam/common/.steam
 * - /snap/steam/...
 */
export function isSnapSteam(steamPath?: string): boolean {
  if (!steamPath) return false;
  return steamPath.includes("/snap/steam/") || steamPath.includes("snap/steam/");
}

/**
 * Перевірка, чи знаходиться каталог на вторинному або знімному накопичувачі
 * (/media, /run/media, /mnt).
 *
 * Освітній коментар:
 * У суворій ізоляції Snap (strict confinement) AppArmor за замовчуванням
 * блокує доступ до шляхів монтування зовнішніх накопичувачів (/media, /run/media, /mnt).
 * Для доступу до них необхідно підключити інтерфейс 'removable-media'.
 */
export function isRemovableOrSecondaryPath(targetPath: string): boolean {
  const normalized = path.resolve(targetPath);
  return (
    normalized.startsWith("/run/media/") ||
    normalized.startsWith("/media/") ||
    normalized.startsWith("/mnt/")
  );
}

/**
 * Генерація точної команди підключення інтерфейсу 'removable-media' у Snap.
 */
export function getSnapRemovableMediaCommand(appId = STEAM_SNAP_ID): string {
  const quote = (val: string) => `'${val.replace(/'/g, `'\\''`)}'`;
  return `snap connect ${quote(appId)}:removable-media`;
}

/**
 * Визначення відповідного ідентифікатора Snap-додатка (Vortex або Steam).
 */
export function snapAccessAppId(
  steamPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (isVortexInSnap(env)) {
    return env.SNAP_NAME || VORTEX_SNAP_ID;
  }
  return isSnapSteam(steamPath) ? STEAM_SNAP_ID : undefined;
}

/**
 * Оцінка доступу до каталогу з урахуванням політик пісочниці Snap.
 *
 * Перевіряє:
 * 1. Чи активна пісочниця Snap для Vortex або Steam.
 * 2. Чи знаходиться цільовий каталог на вторинному або знімному носії (/mnt, /media, /run/media).
 * 3. Чи доступний каталог на читання та запис.
 */
export function assessSnapDirectoryAccess(
  targetDir: string,
  steamPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): ISnapPermissionIssue | undefined {
  const appId = snapAccessAppId(steamPath, env);
  if (!appId) {
    return undefined;
  }

  const normalized = path.resolve(targetDir);
  const isRemovable = isRemovableOrSecondaryPath(normalized);

  // Перевірка доступності на рівні файлової системи
  let hasAccess = true;
  try {
    let checkPath = normalized;
    while (!fs.existsSync(checkPath) && checkPath !== path.dirname(checkPath)) {
      checkPath = path.dirname(checkPath);
    }
    fs.accessSync(checkPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    hasAccess = false;
  }

  // Якщо шлях на знімному носії або немає доступу
  if (!hasAccess || isRemovable) {
    const command = getSnapRemovableMediaCommand(appId);
    return {
      appId,
      code: "snap-permission-missing",
      severity: "error",
      targetPath: normalized,
      command,
      snapAdvice: `In terminal, connect the removable-media plug for Snap: ${command}`,
      message: `The Snap sandbox '${appId}' requires permission to access secondary/removable storage: ${normalized}`,
    };
  }

  return undefined;
}
