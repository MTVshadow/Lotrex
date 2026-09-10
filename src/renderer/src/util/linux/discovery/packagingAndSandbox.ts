import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { IDiscoveryRemediation, PackagingFormat, SandboxVisibility } from "./contracts";

export interface IPackagingDetectionResult {
  format: PackagingFormat;
  appId?: string;
  isNix: boolean;
}

export interface ISandboxVisibilityAssessment {
  visibility: SandboxVisibility;
  pathExists: boolean;
  isAccessible: boolean;
  remediation?: IDiscoveryRemediation;
}

/**
 * Визначення формату пакування цільового ресурсу або середовища виконання.
 *
 * Освітній коментар:
 * Функція нормалізує native, flatpak, snap, appimage, nix та portable установки.
 * Для Nix/NixOS перевіряються шляхи /nix/store, профілі NIX_PROFILES та маркер /etc/NIXOS.
 */
export function detectPackagingFormat(
  targetPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): IPackagingDetectionResult {
  const normPath = targetPath ? path.resolve(targetPath) : "";

  // 1. Nix / NixOS детекція
  const isNixPath = normPath.startsWith("/nix/store") || normPath.includes("/nix/var/nix/profiles");
  const isNixEnv = Boolean(env.NIX_PROFILES || env.NIX_PATH || fs.existsSync("/etc/NIXOS"));
  if (isNixPath || (normPath === "" && isNixEnv)) {
    return {
      format: "nix",
      isNix: true,
    };
  }

  // 2. Flatpak детекція
  const flatpakAppMatch = normPath.match(/[/\\]\.var[/\\]app[/\\]([^/\\]+)/);
  if (flatpakAppMatch) {
    return {
      format: "flatpak",
      appId: flatpakAppMatch[1],
      isNix: false,
    };
  }
  if (!normPath && (env.FLATPAK_ID || fs.existsSync("/.flatpak-info"))) {
    return {
      format: "flatpak",
      appId: env.FLATPAK_ID || "app",
      isNix: false,
    };
  }

  // 3. Snap детекція
  const snapPathMatch = normPath.match(/[/\\]snap[/\\]([^/\\]+)/);
  if (snapPathMatch) {
    return {
      format: "snap",
      appId: snapPathMatch[1],
      isNix: false,
    };
  }
  if (!normPath && env.SNAP) {
    return {
      format: "snap",
      appId: env.SNAP_NAME || path.basename(env.SNAP),
      isNix: false,
    };
  }

  // 4. AppImage детекція
  if (env.APPIMAGE || normPath.includes("/.mount_") || normPath.endsWith(".AppImage")) {
    return {
      format: "appimage",
      isNix: false,
    };
  }

  // 5. Portable чи звичайна рідна система (Native)
  const isStandardSystem =
    normPath.startsWith("/usr") ||
    normPath.startsWith("/var") ||
    normPath.startsWith("/etc") ||
    normPath.startsWith("/opt") ||
    normPath.includes("/.local/") ||
    normPath.includes("/.local") ||
    normPath.startsWith(path.join(env.HOME || os.homedir(), ".local"));

  return {
    format: isStandardSystem || !normPath ? "native" : "portable",
    isNix: false,
  };
}

/**
 * Оцінка видимості шляху всередині пісочниці окремо від фізичного існування шляху.
 *
 * Освітній коментар:
 * Роадмап Phase 3 вимагає: "Report sandbox visibility separately from path existence".
 * Наприклад, зовнішній диск /run/media/... може фізично існувати на хості, але бути
 * невидимим або недоступним для додатка у Flatpak пісочниці без спеціального дозволу.
 */
export function assessSandboxVisibility(
  targetPath: string,
  hostPackaging: PackagingFormat = "native",
  options: {
    appId?: string;
    env?: NodeJS.ProcessEnv;
    fsCheck?: (p: string) => boolean;
    accessCheck?: (p: string) => boolean;
  } = {},
): ISandboxVisibilityAssessment {
  const normPath = path.resolve(targetPath);
  const existsFn = options.fsCheck || fs.existsSync;
  const accessFn =
    options.accessCheck ||
    ((p: string) => {
      try {
        fs.accessSync(p, fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    });

  const pathExists = existsFn(normPath);
  const isDirectlyAccessible = accessFn(normPath);

  // 1. Документний портал XDG (/run/user/.../doc/)
  if (normPath.includes("/run/user/") && normPath.includes("/doc/")) {
    return {
      visibility: "portal",
      pathExists,
      isAccessible: isDirectlyAccessible,
    };
  }

  // 2. Середовище Flatpak
  if (hostPackaging === "flatpak") {
    const appId = options.appId || "com.nexusmods.vortex";
    const appDataPrefix = path.join(os.homedir(), ".var", "app", appId);

    // Доступ всередині власної теки пісочниці завжди direct
    if (normPath.startsWith(appDataPrefix)) {
      return {
        visibility: "direct",
        pathExists,
        isAccessible: isDirectlyAccessible,
      };
    }

    // Якщо шлях зовні пісочниці і недоступний — restricted з ремедіацією override
    if (!isDirectlyAccessible) {
      const quote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
      return {
        visibility: pathExists ? "restricted" : "isolated",
        pathExists,
        isAccessible: false,
        remediation: {
          code: "flatpak-sandbox-override-required",
          message: `Flatpak sandbox restricts access to path: ${normPath}`,
          command: `flatpak override --user --filesystem=${quote(normPath)} ${quote(appId)}`,
        },
      };
    }
  }

  // 3. Середовище Snap
  if (hostPackaging === "snap") {
    const appId = options.appId || "vortex";
    const isRemovable =
      normPath.startsWith("/media") ||
      normPath.startsWith("/run/media") ||
      normPath.startsWith("/mnt");

    if (isRemovable && !isDirectlyAccessible) {
      return {
        visibility: "restricted",
        pathExists,
        isAccessible: false,
        remediation: {
          code: "snap-removable-media-required",
          message: `Snap sandbox requires removable-media plug for: ${normPath}`,
          command: `snap connect ${appId}:removable-media`,
        },
      };
    }
  }

  // 4. За замовчуванням: direct, якщо доступно, або restricted, якщо бракує прав файлової системи
  if (pathExists && !isDirectlyAccessible) {
    return {
      visibility: "restricted",
      pathExists,
      isAccessible: false,
      remediation: {
        code: "filesystem-permission-denied",
        message: `Read permissions missing for path: ${normPath}`,
      },
    };
  }

  return {
    visibility: pathExists ? "direct" : "isolated",
    pathExists,
    isAccessible: isDirectlyAccessible,
  };
}
