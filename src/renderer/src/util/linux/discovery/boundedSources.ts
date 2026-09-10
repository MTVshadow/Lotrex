import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { DiscoveryProviderId, PackagingFormat } from "./contracts";

export type BoundedSourceCategory =
  | "xdg-data"
  | "xdg-config"
  | "steam-manifest"
  | "heroic-manifest"
  | "lutris-db"
  | "desktop-entry"
  | "user-approved-root";

export interface IBoundedSourceDescriptor {
  /** Унікальний ідентифікатор джерела */
  id: string;
  /** Категорія джерела */
  category: BoundedSourceCategory;
  /** Пов'язаний постачальник */
  provider: DiscoveryProviderId;
  /** Абсолютний шлях до джерела або файлу маніфесту */
  resolvedPath: string;
  /** Формат пакування (native, flatpak, snap тощо) */
  packagingFormat: PackagingFormat;
  /** Ідентифікатор додатка пісочниці, якщо є */
  appId?: string;
  /** Ознака існування файлу чи каталогу */
  exists: boolean;
}

export class UnboundedCrawlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnboundedCrawlError";
  }
}

/**
 * Отримання стандартних XDG каталогів згідно зі специфікацією freedesktop.org
 */
export function getXdgBaseDirectories(env: NodeJS.ProcessEnv = process.env, homeDir?: string) {
  const home = homeDir || env.HOME || os.homedir();
  return {
    dataHome: env.XDG_DATA_HOME
      ? path.resolve(env.XDG_DATA_HOME)
      : path.join(home, ".local", "share"),
    configHome: env.XDG_CONFIG_HOME
      ? path.resolve(env.XDG_CONFIG_HOME)
      : path.join(home, ".config"),
    stateHome: env.XDG_STATE_HOME
      ? path.resolve(env.XDG_STATE_HOME)
      : path.join(home, ".local", "state"),
    dataDirs: env.XDG_DATA_DIRS
      ? env.XDG_DATA_DIRS.split(":").map((p) => path.resolve(p))
      : ["/usr/local/share", "/usr/share"],
    configDirs: env.XDG_CONFIG_DIRS
      ? env.XDG_CONFIG_DIRS.split(":").map((p) => path.resolve(p))
      : ["/etc/xdg"],
  };
}

/**
 * Реєстр обмежених джерел пошуку для Steam (Native, Flatpak, Snap)
 */
export function getSteamBoundedSources(
  homeDir?: string,
  env: NodeJS.ProcessEnv = process.env,
  customRoots: string[] = [],
): IBoundedSourceDescriptor[] {
  const home = homeDir || env.HOME || os.homedir();
  const xdg = getXdgBaseDirectories(env, home);

  const sources: Array<{
    id: string;
    resolvedPath: string;
    packagingFormat: PackagingFormat;
    appId?: string;
  }> = [
    {
      id: "steam:native:xdg-data",
      resolvedPath: path.join(xdg.dataHome, "Steam"),
      packagingFormat: "native",
    },
    {
      id: "steam:native:dot-steam-root",
      resolvedPath: path.join(home, ".steam", "root"),
      packagingFormat: "native",
    },
    {
      id: "steam:native:dot-steam-steam",
      resolvedPath: path.join(home, ".steam", "steam"),
      packagingFormat: "native",
    },
    {
      id: "steam:flatpak:var-data",
      resolvedPath: path.join(home, ".var", "app", "com.valvesoftware.Steam", "data", "Steam"),
      packagingFormat: "flatpak",
      appId: "com.valvesoftware.Steam",
    },
    {
      id: "steam:snap:common-data",
      resolvedPath: path.join(home, "snap", "steam", "common", ".local", "share", "Steam"),
      packagingFormat: "snap",
      appId: "steam",
    },
  ];

  for (const [index, customRoot] of customRoots.entries()) {
    sources.push({
      id: `steam:custom-root:${index}`,
      resolvedPath: path.resolve(customRoot),
      packagingFormat: "native",
    });
  }

  return sources.map((s) => ({
    ...s,
    category: s.id.includes("custom-root") ? "user-approved-root" : "steam-manifest",
    provider: "steam",
    exists: fs.existsSync(s.resolvedPath),
  }));
}

/**
 * Реєстр обмежених джерел пошуку для Heroic Games Launcher (Native, Flatpak)
 */
export function getHeroicBoundedSources(
  homeDir?: string,
  env: NodeJS.ProcessEnv = process.env,
): IBoundedSourceDescriptor[] {
  const home = homeDir || env.HOME || os.homedir();
  const xdg = getXdgBaseDirectories(env, home);

  const nativeConfig = path.join(xdg.configHome, "heroic");
  const flatpakConfig = path.join(
    home,
    ".var",
    "app",
    "com.heroicgameslauncher.hgl",
    "config",
    "heroic",
  );

  const candidates = [
    {
      id: "heroic:native:legendary",
      resolvedPath: path.join(nativeConfig, "legendaryConfig", "legendary", "installed.json"),
      packagingFormat: "native" as const,
    },
    {
      id: "heroic:native:gog",
      resolvedPath: path.join(nativeConfig, "gog_store", "installed.json"),
      packagingFormat: "native" as const,
    },
    {
      id: "heroic:native:gamesconfig",
      resolvedPath: path.join(nativeConfig, "GamesConfig"),
      packagingFormat: "native" as const,
    },
    {
      id: "heroic:flatpak:legendary",
      resolvedPath: path.join(flatpakConfig, "legendaryConfig", "legendary", "installed.json"),
      packagingFormat: "flatpak" as const,
      appId: "com.heroicgameslauncher.hgl",
    },
    {
      id: "heroic:flatpak:gog",
      resolvedPath: path.join(flatpakConfig, "gog_store", "installed.json"),
      packagingFormat: "flatpak" as const,
      appId: "com.heroicgameslauncher.hgl",
    },
    {
      id: "heroic:flatpak:gamesconfig",
      resolvedPath: path.join(flatpakConfig, "GamesConfig"),
      packagingFormat: "flatpak" as const,
      appId: "com.heroicgameslauncher.hgl",
    },
  ];

  return candidates.map((c) => ({
    ...c,
    category: "heroic-manifest",
    provider: "heroic",
    exists: fs.existsSync(c.resolvedPath),
  }));
}

/**
 * Реєстр обмежених джерел пошуку для Lutris (Native, Flatpak)
 */
export function getLutrisBoundedSources(
  homeDir?: string,
  env: NodeJS.ProcessEnv = process.env,
): IBoundedSourceDescriptor[] {
  const home = homeDir || env.HOME || os.homedir();
  const xdg = getXdgBaseDirectories(env, home);

  const nativeData = path.join(xdg.dataHome, "lutris");
  const flatpakData = path.join(home, ".var", "app", "net.lutris.Lutris", "data", "lutris");

  const candidates = [
    {
      id: "lutris:native:db",
      resolvedPath: path.join(nativeData, "pga.db"),
      packagingFormat: "native" as const,
    },
    {
      id: "lutris:native:games-dir",
      resolvedPath: path.join(nativeData, "games"),
      packagingFormat: "native" as const,
    },
    {
      id: "lutris:flatpak:db",
      resolvedPath: path.join(flatpakData, "pga.db"),
      packagingFormat: "flatpak" as const,
      appId: "net.lutris.Lutris",
    },
    {
      id: "lutris:flatpak:games-dir",
      resolvedPath: path.join(flatpakData, "games"),
      packagingFormat: "flatpak" as const,
      appId: "net.lutris.Lutris",
    },
  ];

  return candidates.map((c) => ({
    ...c,
    category: "lutris-db",
    provider: "lutris",
    exists: fs.existsSync(c.resolvedPath),
  }));
}

/**
 * Отримання повного зведеного списку всіх зареєстрованих обмежених джерел
 */
export function getAllRegisteredBoundedSources(
  homeDir?: string,
  env: NodeJS.ProcessEnv = process.env,
  customRoots: string[] = [],
): IBoundedSourceDescriptor[] {
  return [
    ...getSteamBoundedSources(homeDir, env, customRoots),
    ...getHeroicBoundedSources(homeDir, env),
    ...getLutrisBoundedSources(homeDir, env),
  ];
}

/**
 * Захист від безконтрольного сканування файлової системи (Unbounded crawl protection).
 *
 * Перевіряє, що запитуваний шлях є або самим зареєстрованим обмеженим джерелом,
 * або знаходиться суворо всередині нього чи дозволеного кореня.
 * Категорично забороняє сканування кореня '/' або $HOME цілком.
 */
export function assertPathIsBounded(
  targetPath: string,
  allowedSources: IBoundedSourceDescriptor[],
): void {
  const normalized = path.resolve(targetPath);

  // Заборона сканування загальносистемного кореня або кореня користувача
  if (normalized === "/" || normalized === os.homedir()) {
    throw new UnboundedCrawlError(
      `Unbounded filesystem crawling is strictly prohibited on root directory: ${normalized}`,
    );
  }

  const isAllowed = allowedSources.some((source) => {
    const sourceRoot = path.resolve(source.resolvedPath);
    return normalized === sourceRoot || normalized.startsWith(sourceRoot + path.sep);
  });

  if (!isAllowed) {
    throw new UnboundedCrawlError(
      `Target path '${normalized}' is not within any registered bounded source or approved custom root.`,
    );
  }
}
