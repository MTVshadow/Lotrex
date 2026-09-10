import * as fs from "node:fs";
import * as path from "node:path";

import type { IDiscoveredResource, IDiscoveryEvidence } from "./contracts";

/**
 * Отримання фізичного канонічного шляху через розв'язання символічних посилань.
 *
 * Освітній коментар:
 * На Linux типовою є ситуація, коли ~/.steam/root або ~/.steam/steam є симлінком
 * на ~/.local/share/Steam. Щоб уникнути дублювання рантаймів (наприклад GE-Proton),
 * фізичний шлях розв'язується через realpath.
 */
export function resolvePhysicalPath(targetPath: string): string {
  const normalized = path.resolve(targetPath);
  try {
    return fs.realpathSync.native
      ? fs.realpathSync.native(normalized)
      : fs.realpathSync(normalized);
  } catch {
    return normalized;
  }
}

/**
 * Визначення, який з двох еквівалентних шляхів є більш бажаним для відображення користувачу.
 *
 * Перевага віддається стандартизованим XDG-шляхам або явним користувацьким директоріям
 * над внутрішніми симлінками лаунчерів (~/.steam/root чи ~/.steam/steam).
 */
export function isPreferredUserVisiblePath(candidate: string, current: string): boolean {
  const normCandidate = path.resolve(candidate);
  const normCurrent = path.resolve(current);

  // Пріоритет: шляхи без проміжних .steam/root або .steam/steam
  const candidateIsSteamAlias =
    normCandidate.includes(".steam/root") || normCandidate.includes(".steam/steam");
  const currentIsSteamAlias =
    normCurrent.includes(".steam/root") || normCurrent.includes(".steam/steam");

  if (!candidateIsSteamAlias && currentIsSteamAlias) return true;
  if (candidateIsSteamAlias && !currentIsSteamAlias) return false;

  // Менша глибина або коротший шлях
  return normCandidate.length < normCurrent.length;
}

/**
 * Канонізація, дедуплікація та об'єднання свідчень знайдених ресурсів (Phase 5).
 *
 * Освітній коментар:
 * Функція групує ресурси за парою (kind, physicalCanonicalPath).
 * Для однакових фізичних каталогів (наприклад, Proton-рантаймів знайдених через
 * різні симлінки або провайдери):
 * 1. Зберігається найзручніший для користувача канонічний шлях.
 * 2. Усі свідчення (evidence) об'єднуються та дедуплікуються.
 * 3. Рівень достовірності (confidence) підвищується при збігу кількох джерел.
 */
export function deduplicateAndMergeResources(
  resources: IDiscoveredResource[],
): IDiscoveredResource[] {
  const grouped = new Map<string, IDiscoveredResource[]>();

  for (const resource of resources) {
    const physicalPath = resolvePhysicalPath(resource.canonicalPath);
    const key = `${resource.kind}:${physicalPath}`;

    const existing = grouped.get(key) || [];
    existing.push(resource);
    grouped.set(key, existing);
  }

  const mergedResults: IDiscoveredResource[] = [];

  for (const group of grouped.values()) {
    if (group.length === 1) {
      mergedResults.push(group[0]);
      continue;
    }

    // Обираємо базовий ресурс з найкращим шляхом для відображення
    let primary = group[0];
    for (let i = 1; i < group.length; i++) {
      if (isPreferredUserVisiblePath(group[i].canonicalPath, primary.canonicalPath)) {
        primary = group[i];
      }
    }

    // Об'єднуємо свідчення (evidence) без повторів за парою (sourceType, sourcePath)
    const combinedEvidence: IDiscoveryEvidence[] = [];
    const seenEvidenceKeys = new Set<string>();

    for (const res of group) {
      for (const ev of res.evidence) {
        const evKey = `${ev.sourceType}:${path.resolve(ev.sourcePath)}`;
        if (!seenEvidenceKeys.has(evKey)) {
          seenEvidenceKeys.add(evKey);
          combinedEvidence.push(ev);
        }
      }
    }

    // Злиття метаданих
    const mergedMetadata: Record<string, unknown> = {};
    for (const res of group) {
      if (res.metadata) {
        Object.assign(mergedMetadata, res.metadata);
      }
    }

    // Підвищення confidence до "confirmed" при збігу кількох джерел з валідним статусом
    const isValid = group.some((r) => r.validationState.status === "valid");
    const confidence = isValid ? "confirmed" : primary.confidence;

    mergedResults.push({
      ...primary,
      evidence: combinedEvidence,
      confidence,
      metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
    });
  }

  return mergedResults;
}
