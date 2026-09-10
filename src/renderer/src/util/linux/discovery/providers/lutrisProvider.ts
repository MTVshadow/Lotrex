import * as fs from "node:fs";
import * as path from "node:path";

import { readLutrisDatabase } from "../../lutrisDatabase";
import type { IBoundedSourceDescriptor } from "../boundedSources";
import type { IDiscoveredResource } from "../contracts";

/**
 * Провайдер пошуку ресурсів Lutris через безпечне read-only читання pga.db.
 */
export function discoverLutrisResources(
  sources: IBoundedSourceDescriptor[],
): IDiscoveredResource[] {
  const results: IDiscoveredResource[] = [];

  for (const source of sources) {
    if (source.provider !== "lutris" || !source.exists) continue;

    // Працюємо з файлами бази даних pga.db
    if (!source.resolvedPath.endsWith("pga.db")) continue;

    try {
      const games = readLutrisDatabase(source.resolvedPath);

      for (const game of games) {
        if (!game.installed || !game.directory) continue;

        const canonicalPath = path.resolve(game.directory);
        const exists = fs.existsSync(canonicalPath);
        const slug = game.slug || String(game.id);

        results.push({
          id: `lutris:game:${slug}`,
          kind: "game",
          provider: "lutris",
          canonicalPath,
          packagingContext: {
            format: source.packagingFormat,
            appId: source.appId,
            sandboxVisibility: source.packagingFormat === "flatpak" ? "restricted" : "direct",
          },
          evidence: [
            {
              sourceType: "database",
              sourcePath: source.resolvedPath,
              details: {
                id: game.id,
                name: game.name,
                runner: game.runner || "wine",
                slug,
              },
              timestamp: Date.now(),
            },
          ],
          confidence: exists ? "confirmed" : "probable",
          validationState: {
            status: exists ? "valid" : "missing-executable",
          },
          sourceTimestamp: game.installedAt ? game.installedAt * 1000 : Date.now(),
          metadata: {
            displayName: game.name,
            id: game.id,
            platform: game.platform,
            runner: game.runner,
            slug,
          },
        });
      }
    } catch {
      // Помилка читання бази даних Lutris
    }
  }

  return results;
}
