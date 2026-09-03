import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Опис точки монтування файлової системи на Linux (з /proc/mounts).
 */
export interface IMountEntry {
  /** Блоковий пристрій або джерело (/dev/nvme0n1p2, none, fuse тощо) */
  device: string;
  /** Каталог монтування (/home, /mnt/games тощо) */
  mountPoint: string;
  /** Тип файлової системи (ext4, btrfs, ntfs3, fuseblk, exfat тощо) */
  fsType: string;
  /** Опції монтування (rw, ro, noexec, uid=1000 тощо) */
  options: string[];
}

export type FileSystemIssueCode =
  | "read-only"
  | "noexec"
  | "ntfs-prefix"
  | "cross-device-hardlink"
  | "permission-denied";

export interface IFileSystemIssue {
  code: FileSystemIssueCode;
  severity: "error" | "warning";
  message: string;
  path: string;
  mountPoint?: string;
  fsType?: string;
  remediation?: string;
}

/**
 * Список файлових систем, які не підтримують повні POSIX-атрибути
 * (права доступу, сокети, чутливість до регістру), необхідні для префіксів Proton/Wine.
 */
const NON_POSIX_FS_TYPES = new Set([
  "ntfs",
  "ntfs3",
  "fuseblk",
  "exfat",
  "vfat",
  "msdos",
  "cifs",
  "smbfs",
]);

/**
 * Декодування екранованих послідовностей у /proc/mounts (наприклад, \040 для пробілу, \011 для табуляції).
 */
export function decodeMountPath(escaped: string): string {
  return escaped.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

/**
 * Парсинг вмісту /proc/mounts або /etc/mtab у структурований масив IMountEntry.
 */
export function parseMounts(content: string): IMountEntry[] {
  const lines = content.split("\n");
  const mounts: IMountEntry[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;

    const [device, rawMountPoint, fsType, rawOptions] = parts;
    mounts.push({
      device: decodeMountPath(device),
      mountPoint: decodeMountPath(rawMountPoint),
      fsType,
      options: rawOptions ? rawOptions.split(",") : [],
    });
  }

  return mounts;
}

/**
 * Отримання списку активних монтувань Linux із файлу /proc/mounts.
 */
export function getLinuxMounts(mountsFilePath = "/proc/mounts"): IMountEntry[] {
  try {
    const content = fs.readFileSync(mountsFilePath, "utf8");
    return parseMounts(content);
  } catch {
    return [];
  }
}

/**
 * Пошук найбільш точної (найдовшої за шляхом) точки монтування для заданого шляху.
 */
export function findMountForPath(
  targetPath: string,
  mounts: IMountEntry[],
): IMountEntry | undefined {
  const normalizedTarget = path.resolve(targetPath);
  let bestMatch: IMountEntry | undefined;
  let bestLength = -1;

  for (const mount of mounts) {
    const normMount = path.resolve(mount.mountPoint);
    if (
      normalizedTarget === normMount ||
      normalizedTarget.startsWith(normMount + path.sep) ||
      (normMount === "/" && normalizedTarget.startsWith("/"))
    ) {
      if (normMount.length > bestLength) {
        bestLength = normMount.length;
        bestMatch = mount;
      }
    }
  }

  return bestMatch;
}

/**
 * Перевірка сумісності файлової системи для каталогу гри, staging або префіксу Proton.
 */
export function assessDirectoryFileSystem(
  targetPath: string,
  purpose: "game" | "staging" | "prefix",
  mounts: IMountEntry[] = getLinuxMounts(),
): IFileSystemIssue[] {
  const issues: IFileSystemIssue[] = [];
  const mount = findMountForPath(targetPath, mounts);

  if (mount) {
    const hasRo = mount.options.includes("ro");
    const hasNoExec = mount.options.includes("noexec");

    // 1. Перевірка монтування лише для читання
    if (hasRo) {
      issues.push({
        code: "read-only",
        severity: "error",
        message: `Каталог знаходиться на файловій системі, змонтованій лише для читання (ro): ${mount.mountPoint}`,
        path: targetPath,
        mountPoint: mount.mountPoint,
        fsType: mount.fsType,
        remediation:
          "Перемонтуйте диск із правами запису (rw) або змініть налаштування в /etc/fstab.",
      });
    }

    // 2. Перевірка noexec для каталогів, де виконуються бінарні файли (гра, префікс)
    if (hasNoExec && (purpose === "game" || purpose === "prefix")) {
      issues.push({
        code: "noexec",
        severity: "error",
        message: `Файлова система змонтована з опцією 'noexec', виконання програм неможливе: ${mount.mountPoint}`,
        path: targetPath,
        mountPoint: mount.mountPoint,
        fsType: mount.fsType,
        remediation: "Видаліть опцію 'noexec' із параметрів монтування розділу в /etc/fstab.",
      });
    }

    // 3. Перевірка префіксу Proton на несумісних файлових системах (NTFS/FAT/exFAT)
    if (purpose === "prefix" && NON_POSIX_FS_TYPES.has(mount.fsType.toLowerCase())) {
      issues.push({
        code: "ntfs-prefix",
        severity: "warning",
        message: `Префікс Proton розташований на не-POSIX файловій системі (${mount.fsType}): ${mount.mountPoint}`,
        path: targetPath,
        mountPoint: mount.mountPoint,
        fsType: mount.fsType,
        remediation:
          "Рекомендується перенести префікс Proton або каталог steamapps на рідну файлову систему Linux (ext4, btrfs тощо), оскільки Wine потребує коректних POSIX прав та символьних посилань.",
      });
    }
  }

  // 4. Перевірка фактичних прав запису у каталог (W_OK)
  try {
    let checkDir = targetPath;
    while (!fs.existsSync(checkDir) && checkDir !== path.dirname(checkDir)) {
      checkDir = path.dirname(checkDir);
    }
    fs.accessSync(checkDir, fs.constants.W_OK);
  } catch {
    issues.push({
      code: "permission-denied",
      severity: "error",
      message: `Відсутні права на запис у каталог: ${targetPath}`,
      path: targetPath,
      mountPoint: mount?.mountPoint,
      fsType: mount?.fsType,
      remediation: "Перевірте права власності (chown) або дозволи (chmod) для поточної директорії.",
    });
  }

  return issues;
}

/**
 * Перевірка сумісності хардлінків між staging-каталогом та каталогом гри.
 * Хардлінки на POSIX вимагають однакового номера пристрою (st_dev).
 */
export function checkHardlinkCompatibility(
  stagingPath: string,
  gamePath: string,
): IFileSystemIssue | undefined {
  try {
    let existingStaging = stagingPath;
    while (!fs.existsSync(existingStaging) && existingStaging !== path.dirname(existingStaging)) {
      existingStaging = path.dirname(existingStaging);
    }

    let existingGame = gamePath;
    while (!fs.existsSync(existingGame) && existingGame !== path.dirname(existingGame)) {
      existingGame = path.dirname(existingGame);
    }

    const stagingStat = fs.statSync(existingStaging);
    const gameStat = fs.statSync(existingGame);

    if (stagingStat.dev !== gameStat.dev) {
      return {
        code: "cross-device-hardlink",
        severity: "error",
        message:
          "Каталог модів (staging) та каталог гри розташовані на різних пристроях файлової системи (EXDEV). Хардлінки не підтримуються між різними дисками або розділами.",
        path: stagingPath,
        remediation:
          "Перемістіть каталог staging на той самий диск, де встановлена гра, або оберіть метод розгортання через символьні посилання (Symlink).",
      };
    }
  } catch {
    // Якщо каталоги ще не існують і перевірка не вдалася, не блокуємо попередньо
  }

  return undefined;
}
