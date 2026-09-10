import * as fs from "node:fs";
import * as path from "node:path";

import type { IBoundedSourceDescriptor } from "../boundedSources";
import type { IDiscoveredResource } from "../contracts";

/**
 * Провайдер пошуку встановлених ігор Heroic Games Launcher (GOG та Epic/Legendary).
 */
export function discoverHeroicResources(
  sources: IBoundedSourceDescriptor[],
): IDiscoveredResource[] {
  const results: IDiscoveredResource[] = [];

  for (const source of sources) {
    if (source.provider !== "heroic" || !source.exists) continue;

    // Працюємо лише з файлами installed.json
    if (!source.resolvedPath.endsWith("installed.json")) continue;

    try {
      const content = fs.readFileSync(source.resolvedPath, "utf8");
      const parsed = JSON.parse(content);
      const isGog = source.resolvedPath.includes("gog_store");
      const runner = isGog ? "gog" : "legendary";

      // Формат installed.json може бути масивом або об'єктом з ключами appId
      const entries: Array<Record<string, any>> = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.installed)
          ? parsed.installed
          : Object.values(parsed || {});

      for (const game of entries) {
        if (!game || typeof game !== "object") continue;

        const appId = String(game.app_name || game.appName || game.appid || "");
        const installPath = String(game.install_path || game.installPath || game.path || "");
        const title = String(game.title || game.name || appId);

        if (!appId || !installPath) continue;

        const canonicalPath = path.resolve(installPath);
        const exists = fs.existsSync(canonicalPath);

        results.push({
          id: `heroic:${runner}:${appId}`,
          kind: "game",
          provider: "heroic",
          canonicalPath,
          packagingContext: {
            format: source.packagingFormat,
            appId: source.appId,
            sandboxVisibility: source.packagingFormat === "flatpak" ? "restricted" : "direct",
          },
          evidence: [
            {
              sourceType: "manifest",
              sourcePath: source.resolvedPath,
              details: { appId, runner, title },
              timestamp: Date.now(),
            },
          ],
          confidence: exists ? "confirmed" : "probable",
          validationState: {
            status: exists ? "valid" : "missing-executable",
          },
          sourceTimestamp: Date.now(),
          metadata: {
            appId,
            displayName: title,
            runner,
          },
        });
      }
    } catch {
      // Помилка читання або парсингу окремого файлу маніфесту
    }
  }

  return results;
}
