import * as path from "node:path";

export interface ICaseCollisionItem {
  relPath: string;
  sourcePath?: string;
  modId?: string;
}

export interface ICaseCollisionGroup {
  /** Unicode- та case-нормалізований відносний POSIX-шлях. */
  normalizedPath: string;
  /** Усі сирі варіанти, які зводяться до одного логічного шляху. */
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
 * Normalize separators and dot segments before applying locale-independent Unicode casing.
 * NFC is applied on both sides of lowercasing because mappings such as U+0130 may introduce a
 * combining mark.
 */
export function normalizeCasePath(relPath: string): string {
  const posixPath = path.posix.normalize(relPath.replace(/\\/g, "/"));
  return posixPath.normalize("NFC").toLowerCase().normalize("NFC");
}

/**
 * Detect case and canonical-Unicode collisions in a deployment plan.
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

  return collisions.sort((lhs, rhs) => lhs.normalizedPath.localeCompare(rhs.normalizedPath));
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
