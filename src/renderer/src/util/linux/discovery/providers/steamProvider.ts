import * as fs from "node:fs";
import * as path from "node:path";

import { parse as parseVdf } from "simple-vdf";

import { extractSteamLibraryPaths } from "../../steamPaths";
import type { IBoundedSourceDescriptor } from "../boundedSources";
import type { IDiscoveredResource } from "../contracts";

/**
 * Провайдер пошуку ресурсів Steam у межах обмежених джерел.
 *
 * Освітній коментар:
 * Сканує виключно визначені кореневі точки Steam (XDG, Flatpak, Snap, user-approved),
 * аналізує libraryfolders.vdf та appmanifest-файли без глобального рекурсивного обходу диску.
 */
export function discoverSteamResources(sources: IBoundedSourceDescriptor[]): IDiscoveredResource[] {
  const results: IDiscoveredResource[] = [];

  for (const source of sources) {
    if (source.provider !== "steam" || !source.exists) continue;

    const steamRoot = path.resolve(source.resolvedPath);

    // 1. Сам лаунчер Steam
    results.push({
      id: source.id,
      kind: "launcher",
      provider: "steam",
      canonicalPath: steamRoot,
      packagingContext: {
        format: source.packagingFormat,
        appId: source.appId,
        sandboxVisibility: source.packagingFormat === "flatpak" ? "restricted" : "direct",
      },
      evidence: [
        {
          sourceType: "manifest",
          sourcePath: steamRoot,
          details: { format: source.packagingFormat },
          timestamp: Date.now(),
        },
      ],
      confidence: "confirmed",
      validationState: { status: "valid" },
      sourceTimestamp: Date.now(),
      metadata: { format: source.packagingFormat },
    });

    // 2. Бібліотеки Steam (libraryfolders.vdf)
    const vdfPath = path.join(steamRoot, "steamapps", "libraryfolders.vdf");
    const libraries: string[] = [];

    if (fs.existsSync(vdfPath)) {
      try {
        const content = fs.readFileSync(vdfPath, "utf8");
        const parsed = parseVdf(content) as Record<string, any>;
        const folderPaths = extractSteamLibraryPaths(
          parsed?.libraryfolders || parsed?.LibraryFolders,
          steamRoot,
        );
        libraries.push(...folderPaths);
      } catch {
        libraries.push(steamRoot);
      }
    } else {
      libraries.push(steamRoot);
    }

    const uniqueLibraries = Array.from(new Set(libraries.map((lib) => path.resolve(lib))));

    for (const libraryPath of uniqueLibraries) {
      if (!fs.existsSync(libraryPath)) continue;

      results.push({
        id: `steam:library:${Buffer.from(libraryPath).toString("hex").slice(0, 16)}`,
        kind: "library",
        provider: "steam",
        canonicalPath: libraryPath,
        packagingContext: {
          format: source.packagingFormat,
          appId: source.appId,
        },
        evidence: [
          {
            sourceType: "manifest",
            sourcePath: fs.existsSync(vdfPath) ? vdfPath : steamRoot,
            timestamp: Date.now(),
          },
        ],
        confidence: "confirmed",
        validationState: { status: "valid" },
        sourceTimestamp: Date.now(),
      });

      // 3. Ігри у бібліотеці (appmanifest_*.vdf)
      const steamAppsDir = path.join(libraryPath, "steamapps");
      if (fs.existsSync(steamAppsDir)) {
        try {
          const entries = fs.readdirSync(steamAppsDir);
          for (const entry of entries) {
            const manifestMatch = entry.match(/^appmanifest_(\d+)\.vdf$/);
            if (!manifestMatch) continue;

            const appId = manifestMatch[1];
            const manifestFile = path.join(steamAppsDir, entry);
            try {
              const manifestContent = fs.readFileSync(manifestFile, "utf8");
              const manifestData = parseVdf(manifestContent) as Record<string, any>;
              const appState = manifestData?.AppState || manifestData?.appstate;
              const name = String(appState?.name || `Steam App ${appId}`);
              const installdir = String(appState?.installdir || "");

              const gamePath = installdir
                ? path.join(steamAppsDir, "common", installdir)
                : path.join(steamAppsDir, "common", name);

              results.push({
                id: `steam:game:${appId}`,
                kind: "game",
                provider: "steam",
                canonicalPath: path.resolve(gamePath),
                packagingContext: {
                  format: source.packagingFormat,
                  appId: source.appId,
                },
                evidence: [
                  {
                    sourceType: "manifest",
                    sourcePath: manifestFile,
                    details: { appId, buildId: appState?.buildid || 0 },
                    timestamp: Date.now(),
                  },
                ],
                confidence: fs.existsSync(gamePath) ? "confirmed" : "probable",
                validationState: {
                  status: fs.existsSync(gamePath) ? "valid" : "missing-executable",
                },
                sourceTimestamp: Date.now(),
                metadata: {
                  appId,
                  displayName: name,
                  installdir,
                },
              });
            } catch {
              // Пошкоджений окремий маніфест не повинен зупиняти пошук
            }
          }
        } catch {
          // Пропуск недоступної теки
        }
      }
    }

    // 4. Користувацькі Proton-рантайми у compatibilitytools.d
    const customToolsDir = path.join(steamRoot, "compatibilitytools.d");
    if (fs.existsSync(customToolsDir)) {
      try {
        const tools = fs.readdirSync(customToolsDir);
        for (const tool of tools) {
          const toolDir = path.join(customToolsDir, tool);
          const protonExe = path.join(toolDir, "proton");
          if (fs.existsSync(protonExe)) {
            results.push({
              id: `steam:runtime:${tool}`,
              kind: "compatibility-runtime",
              provider: "steam",
              canonicalPath: path.resolve(toolDir),
              packagingContext: {
                format: source.packagingFormat,
                appId: source.appId,
              },
              evidence: [
                {
                  sourceType: "manifest",
                  sourcePath: protonExe,
                  timestamp: Date.now(),
                },
              ],
              confidence: "confirmed",
              validationState: { status: "valid" },
              sourceTimestamp: Date.now(),
              metadata: {
                runtimeName: tool,
              },
            });
          }
        }
      } catch {
        // Пропуск
      }
    }
  }

  return results;
}
