import * as path from "node:path";

export interface ICaseCollisionItem {
  relPath: string;
  sourcePath?: string;
  modId?: string;
}

export interface ICaseCollisionGroup {
  /** Нормалізований відносний шлях у нижньому регістрі */
  normalizedPath: string;
  /** Усі варіанти шляху, які відрізняються лише регістром символів */
  variants: string[];
  /** Моди та вихідні файли, що конфліктують */
  sources: ICaseCollisionItem[];
}

export class CaseCollisionError extends Error {
  public readonly code = "CASE_COLLISION";

  constructor(public readonly collisions: ICaseCollisionGroup[]) {
    super(formatCaseCollisionReport(collisions));
    this.name = "CaseCollisionError";
  }
}

/**
 * Нормалізація шляху для порівняння без урахування регістру (case-folding).
 */
export function normalizeCasePath(relPath: string): string {
  return path.normalize(relPath).replace(/\\/g, "/").toLowerCase();
}

/**
 * Виявлення колізій регістру (Case-sensitivity collisions) у плані розгортання файлів.
 * На файлових системах Linux (ext4, btrfs, xfs) файли `Textures/icon.dds` та `textures/Icon.dds`
 * є різними файлами в різних папках, що призводить до дублювання або ігнорування грою.
 */
export function detectCaseCollisions(items: ICaseCollisionItem[]): ICaseCollisionGroup[] {
  const groups = new Map<string, ICaseCollisionItem[]>();

  for (const item of items) {
    if (!item.relPath) continue;
    const key = normalizeCasePath(item.relPath);
    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const collisions: ICaseCollisionGroup[] = [];

  for (const [normalizedPath, groupItems] of groups.entries()) {
    const distinctVariants = Array.from(new Set(groupItems.map((i) => i.relPath)));
    if (distinctVariants.length > 1) {
      collisions.push({
        normalizedPath,
        variants: distinctVariants,
        sources: groupItems,
      });
    }
  }

  return collisions;
}

/**
 * Форматування опису виявлених колізій регістру для діалогу або логування.
 */
export function formatCaseCollisionReport(collisions: ICaseCollisionGroup[]): string {
  if (collisions.length === 0) {
    return "No case-sensitive filename collisions were found.";
  }

  const lines: string[] = [`Found ${collisions.length} case-sensitive filename collision(s):`];

  for (const collision of collisions) {
    lines.push(`\n- Path: ${collision.normalizedPath}`);
    lines.push("  Variants:");
    for (const source of collision.sources) {
      const modInfo = source.modId ? ` (mod: ${source.modId})` : "";
      lines.push(`    • ${source.relPath}${modInfo}`);
    }
  }

  return lines.join("\n");
}
