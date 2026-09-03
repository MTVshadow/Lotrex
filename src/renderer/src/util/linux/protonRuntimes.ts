import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getLinuxSteamPaths } from "./steamPaths";

export type ProtonRuntimeType = "auto" | "steam-selected" | "experimental" | "ge-proton" | "custom";

export interface IProtonRuntimeOption {
  id: string;
  name: string;
  type: ProtonRuntimeType;
  path: string;
  isUsable: boolean;
  source: "steamapps" | "compatibilitytools.d" | "custom";
  version?: string;
}

/**
 * Валідація довільного шляху до Proton, введеного користувачем вручну.
 */
export function validateCustomProtonPath(customPath: string): { valid: boolean; error?: string } {
  if (!customPath || customPath.trim().length === 0) {
    return { valid: false, error: "Шлях до середовища Proton не може бути порожнім." };
  }

  const normalized = path.resolve(customPath);
  if (!fs.existsSync(normalized)) {
    return { valid: false, error: `Вказаний каталог не існує: ${normalized}` };
  }

  const protonBin = path.join(normalized, "proton");
  if (!fs.existsSync(protonBin)) {
    return {
      valid: false,
      error: `У каталозі відсутній обов'язковий скрипт 'proton': ${protonBin}`,
    };
  }

  try {
    fs.accessSync(protonBin, fs.constants.X_OK);
  } catch {
    return {
      valid: false,
      error: `Файл '${protonBin}' не має прав на виконання (+x).`,
    };
  }

  return { valid: true };
}

/**
 * Сканування системи для виявлення всіх встановлених рантаймів Proton (Steam, GE-Proton, тощо).
 */
export function discoverAvailableProtonRuntimes(steamPath?: string): IProtonRuntimeOption[] {
  const home = os.homedir();
  const searchRoots = new Set<string>();

  if (steamPath) {
    searchRoots.add(steamPath);
  }

  for (const sPath of getLinuxSteamPaths()) {
    searchRoots.add(sPath);
  }

  const candidateDirs: Array<{ dir: string; source: "steamapps" | "compatibilitytools.d" }> = [];

  for (const sRoot of searchRoots) {
    candidateDirs.push(
      { dir: path.join(sRoot, "steamapps", "common"), source: "steamapps" },
      { dir: path.join(sRoot, "compatibilitytools.d"), source: "compatibilitytools.d" },
    );
  }

  candidateDirs.push(
    {
      dir: path.join(home, ".local", "share", "Steam", "compatibilitytools.d"),
      source: "compatibilitytools.d",
    },
    {
      dir: path.join(
        home,
        ".var",
        "app",
        "com.valvesoftware.Steam",
        "data",
        "Steam",
        "compatibilitytools.d",
      ),
      source: "compatibilitytools.d",
    },
  );

  const seenPaths = new Set<string>();
  const runtimes: IProtonRuntimeOption[] = [];

  for (const { dir, source } of candidateDirs) {
    if (!fs.existsSync(dir)) continue;

    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        if (seenPaths.has(fullPath)) continue;

        const protonBin = path.join(fullPath, "proton");
        if (fs.existsSync(protonBin)) {
          seenPaths.add(fullPath);

          let type: ProtonRuntimeType = "custom";
          if (/GE-Proton/i.test(entry)) {
            type = "ge-proton";
          } else if (/experimental/i.test(entry)) {
            type = "experimental";
          } else if (/proton/i.test(entry)) {
            type = "steam-selected";
          }

          runtimes.push({
            id: entry,
            name: entry,
            type,
            path: fullPath,
            isUsable: true,
            source,
          });
        }
      }
    } catch {
      // Ігноруємо недоступні директорії
    }
  }

  return runtimes;
}
