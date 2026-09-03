import * as path from "path";

import { parse } from "simple-vdf";

import * as fs from "../fs";
import { log } from "../log";

export interface IProtonInfo {
  usesProton: boolean;
  compatDataPath?: string;
  protonPath?: string;
}

/**
 * Check if a game uses Proton by looking for its compatdata folder
 */
export async function detectProtonUsage(steamAppsPath: string, appId: string): Promise<boolean> {
  const compatDataPath = path.join(steamAppsPath, "compatdata", appId);
  try {
    await fs.statAsync(compatDataPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the compatdata path for a game
 */
export function getCompatDataPath(steamAppsPath: string, appId: string): string {
  return path.join(steamAppsPath, "compatdata", appId);
}

/**
 * Get the Wine prefix path within compatdata
 */
export function getWinePrefixPath(compatDataPath: string): string {
  return path.join(compatDataPath, "pfx");
}

/**
 * Read Steam's config.vdf to find the configured Proton version for a game
 */
export async function getConfiguredProtonName(
  steamPath: string,
  appId: string,
): Promise<string | undefined> {
  const configPath = path.join(steamPath, "config", "config.vdf");
  try {
    const configData = await fs.readFileAsync(configPath, "utf8");
    const config = parse(configData.toString()) as any;
    const mapping = config?.InstallConfigStore?.Software?.Valve?.Steam?.CompatToolMapping;
    return mapping?.[appId]?.name;
  } catch (err: any) {
    log("debug", "Could not read Steam config.vdf", { error: err?.message });
    return undefined;
  }
}

/**
 * Check if a path exists asynchronously
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.statAsync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract a searchable keyword from a Proton config name.
 * Config names use formats like "proton_experimental", "proton_9", "proton_hotfix".
 * Returns the portion after "proton_" for fuzzy matching against folder names.
 */
function extractProtonKeyword(protonName: string): string | undefined {
  const lower = protonName.toLowerCase();
  if (!lower.startsWith("proton_")) {
    return undefined;
  }
  return lower.slice("proton_".length);
}

/**
 * Check if a folder name matches a Proton keyword via fuzzy matching.
 * Handles cases like: "proton_experimental" -> "Proton - Experimental"
 *                     "proton_9" -> "Proton 9.0"
 *                     "proton_hotfix" -> "Proton Hotfix"
 */
function folderMatchesKeyword(folderName: string, keyword: string): boolean {
  const lowerFolder = folderName.toLowerCase();

  // Direct substring match (handles "experimental", "hotfix", etc.)
  if (lowerFolder.includes(keyword)) {
    return true;
  }

  // Version number match: "9" should match "9.0", "9.1", etc.
  if (/^\d+$/.test(keyword)) {
    const versionPattern = new RegExp(`\\b${keyword}(\\.\\d+)?\\b`);
    return versionPattern.test(lowerFolder);
  }

  return false;
}

/**
 * Resolve a Proton config name to its installation path.
 *
 * Steam stores the configured Proton version in config.vdf using internal names
 * (e.g., "proton_experimental", "proton_9", "GE-Proton10-28"), but the actual
 * installation folders use different naming conventions:
 *   - config.vdf: "proton_experimental" -> folder: "Proton - Experimental"
 *   - config.vdf: "proton_9"            -> folder: "Proton 9.0"
 *   - config.vdf: "GE-Proton10-28"      -> folder: "GE-Proton10-28" (exact match)
 *
 * Steam provides no direct mapping between these names. Custom tools (GE-Proton, etc.)
 * use matching names, but official Proton versions do not.
 *
 * Resolution strategy (no hardcoded mappings):
 * 1. Custom tools: Check compatibilitytools.d/{name} - custom Proton builds
 *    use their config name as the folder name directly.
 * 2. Exact match: Check steamapps/common/{name} - in case config name matches.
 * 3. Fuzzy match: Scan steamapps/common/Proton* folders and match by keyword.
 *    Extract the keyword after "proton_" and find a folder containing it.
 *
 * This approach is self-maintaining and doesn't require updates when Valve
 * releases new Proton versions.
 */
export async function resolveProtonPath(
  steamPath: string,
  protonName: string,
): Promise<string | undefined> {
  // 1. Check custom compatibility tools directory (GE-Proton, etc.) across possible Steam paths
  const home = process.env.HOME || "";
  const customToolCandidates = [
    path.join(steamPath, "compatibilitytools.d", protonName),
    path.join(home, ".local", "share", "Steam", "compatibilitytools.d", protonName),
    path.join(home, ".steam", "root", "compatibilitytools.d", protonName),
    path.join(home, ".steam", "steam", "compatibilitytools.d", protonName),
  ];

  for (const candidate of customToolCandidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  const commonPath = path.join(steamPath, "steamapps", "common");

  // 2. Check for exact match in steamapps/common
  const exactPath = path.join(commonPath, protonName);
  if (await pathExists(exactPath)) {
    return exactPath;
  }

  // 3. Fuzzy match: scan Proton* folders and match by keyword
  const keyword = extractProtonKeyword(protonName);
  if (keyword) {
    try {
      const entries = await fs.readdirAsync(commonPath);
      const protonDirs = entries.filter((e) => e.toLowerCase().startsWith("proton"));

      for (const dir of protonDirs) {
        if (folderMatchesKeyword(dir, keyword)) {
          return path.join(commonPath, dir);
        }
      }
    } catch (err: any) {
      log("debug", "Could not scan steamapps/common for Proton", {
        error: err?.message,
      });
    }
  }

  return undefined;
}

const LEGACY_GAMES_REQUIRING_MEDIA_CODECS = new Set([
  "22300", // Fallout 3
  "22370", // Fallout 3 GOTY
  "22380", // Fallout New Vegas
  "22490", // Fallout New Vegas PCR
  "22330", // Oblivion
]);

/**
 * Оцінка пріоритету версії Proton для вибору найновішої стабільної версії
 */
function scoreProtonVersion(name: string, appId?: string): number {
  const isGe = /GE-Proton/i.test(name);
  const match = name.match(/(?:Proton|GE-Proton|UMU-Proton)[\s-]*(\d+)(?:[.-](\d+))?/i);
  let score = 0;
  if (match) {
    const major = parseInt(match[1], 10);
    const minor = match[2] ? parseInt(match[2], 10) : 0;
    score = major * 1000 + minor;
  } else if (/experimental/i.test(name)) {
    score = 500;
  } else if (/hotfix/i.test(name)) {
    score = 100;
  }

  // Для старих ігор Bethesda (Fallout 3, NV, Oblivion), де потрібні додаткові кодеки WMF/DirectMusic,
  // надаємо пріоритет GE-Proton
  if (appId && LEGACY_GAMES_REQUIRING_MEDIA_CODECS.has(appId) && isGe) {
    score += 5000;
  }

  return score;
}

/**
 * Find the latest installed Proton version (fallback)
 */
export async function findLatestProton(
  steamPath: string,
  appId?: string,
): Promise<string | undefined> {
  const home = process.env.HOME || "";
  const candidateDirs: string[] = [
    path.join(steamPath, "steamapps", "common"),
    path.join(steamPath, "compatibilitytools.d"),
    path.join(home, ".local", "share", "Steam", "compatibilitytools.d"),
    path.join(home, ".steam", "root", "compatibilitytools.d"),
  ];

  const foundRuntimes: { path: string; score: number }[] = [];

  for (const parentDir of candidateDirs) {
    try {
      if (!(await pathExists(parentDir))) {
        continue;
      }
      const entries = await fs.readdirAsync(parentDir);
      for (const entry of entries) {
        const fullPath = path.join(parentDir, entry);
        const protonBin = path.join(fullPath, "proton");
        if (await pathExists(protonBin)) {
          foundRuntimes.push({
            path: fullPath,
            score: scoreProtonVersion(entry, appId),
          });
        }
      }
    } catch {
      // Ігноруємо недоступні каталоги
    }
  }

  if (foundRuntimes.length > 0) {
    foundRuntimes.sort((a, b) => b.score - a.score);
    return foundRuntimes[0].path;
  }

  return undefined;
}

/**
 * Get full Proton info for a game
 */
export async function getProtonInfo(
  steamPath: string,
  steamAppsPath: string,
  appId: string,
): Promise<IProtonInfo> {
  const usesProton = await detectProtonUsage(steamAppsPath, appId);
  if (!usesProton) {
    return { usesProton: false };
  }

  const compatDataPath = getCompatDataPath(steamAppsPath, appId);

  // Try to get configured Proton, fall back to latest
  const protonName = await getConfiguredProtonName(steamPath, appId);
  let protonPath: string | undefined;

  if (protonName) {
    protonPath = await resolveProtonPath(steamPath, protonName);
  }

  if (!protonPath) {
    protonPath = await findLatestProton(steamPath, appId);
  }

  return { usesProton: true, compatDataPath, protonPath };
}

/**
 * Check if a file is a Windows executable
 */
export function isWindowsExecutable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [".exe", ".bat", ".cmd"].includes(ext);
}

/**
 * Build environment variables for running through Proton
 */
export function buildProtonEnvironment(
  compatDataPath: string,
  steamPath: string,
  existingEnv?: Record<string, string>,
  protonPath?: string,
  gamePath?: string,
): Record<string, string> {
  const env: Record<string, string> = {
    ...existingEnv,
    STEAM_COMPAT_DATA_PATH: compatDataPath,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: steamPath,
    WINEPREFIX: getWinePrefixPath(compatDataPath),
  };
  if (protonPath) {
    // Вказуємо шлях до рантайму Proton для коректної роботи сучасних збірок Proton
    env.STEAM_COMPAT_TOOL_PATHS = protonPath;
  }
  if (gamePath) {
    // Для запуску ігор/інструментів з додаткових розділів або зовнішніх дисків
    env.STEAM_COMPAT_MOUNTS = gamePath;

    // Перевіряємо наявність ENB, ReShade або кастомних перехоплювачів рендерера
    // На Linux Wine/DXVK за замовчуванням блокує зовнішні d3d11/dxgi/d3d9, якщо не вказано native-then-builtin
    const hasCustomD3D = [
      "d3d11.dll",
      "dxgi.dll",
      "d3d9.dll",
      "enbseries.ini",
      "ReShade.ini",
      "dxgi.ini",
    ].some((fileName) => {
      try {
        fs.statSync(path.join(gamePath, fileName));
        return true;
      } catch {
        return false;
      }
    });

    if (hasCustomD3D) {
      const overrides = "d3d11=n,b;dxgi=n,b;d3d9=n,b";
      env.WINEDLLOVERRIDES = env.WINEDLLOVERRIDES
        ? `${env.WINEDLLOVERRIDES};${overrides}`
        : overrides;
      log("info", "Proton: Applied WINEDLLOVERRIDES for ENB/ReShade", {
        gamePath,
        overrides: env.WINEDLLOVERRIDES,
      });
    }
  }
  return env;
}

/**
 * Build the command to run an executable through Proton
 */
export function buildProtonCommand(
  protonPath: string,
  exePath: string,
  args: string[],
): { executable: string; args: string[] } {
  return {
    executable: path.join(protonPath, "proton"),
    args: ["run", exePath, ...args],
  };
}
