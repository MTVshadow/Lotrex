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
  | "insufficient-disk-space"
  | "permission-denied"
  | "network-filesystem"
  | "symlink-unavailable";

export interface IFileSystemIssue {
  availableBytes?: number;
  code: FileSystemIssueCode;
  severity: "error" | "warning";
  message: string;
  path: string;
  mountPoint?: string;
  fsType?: string;
  requiredBytes?: number;
  reserveBytes?: number;
  remediation?: string;
}

const MINIMUM_FREE_SPACE_RESERVE = 512 * 1024 * 1024;

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

const NETWORK_FS_TYPES = new Set([
  "9p",
  "ceph",
  "cifs",
  "fuse.ceph",
  "fuse.glusterfs",
  "fuse.sshfs",
  "glusterfs",
  "nfs",
  "nfs4",
  "smb3",
  "smbfs",
  "sshfs",
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

/** Assess filesystem compatibility for a game, staging, or Proton-prefix directory. */
export function assessDirectoryFileSystem(
  targetPath: string,
  purpose: "game" | "staging" | "prefix",
  mounts: IMountEntry[] = getLinuxMounts(),
  blockNetworkDeployment = false,
): IFileSystemIssue[] {
  const issues: IFileSystemIssue[] = [];
  const mount = findMountForPath(targetPath, mounts);

  if (mount) {
    const hasRo = mount.options.includes("ro");
    const hasNoExec = mount.options.includes("noexec");

    if (hasRo) {
      issues.push({
        code: "read-only",
        severity: "error",
        message: `The directory is on a read-only filesystem: ${mount.mountPoint}`,
        path: targetPath,
        mountPoint: mount.mountPoint,
        fsType: mount.fsType,
        remediation:
          "Choose a writable location, or ask the system administrator to review the mount configuration.",
      });
    }

    if (hasNoExec && (purpose === "game" || purpose === "prefix")) {
      issues.push({
        code: "noexec",
        severity: "error",
        message: `The filesystem is mounted with 'noexec', so programs cannot run from: ${mount.mountPoint}`,
        path: targetPath,
        mountPoint: mount.mountPoint,
        fsType: mount.fsType,
        remediation:
          "Choose an executable location, or ask the system administrator to review the mount options.",
      });
    }

    if (purpose === "prefix" && NON_POSIX_FS_TYPES.has(mount.fsType.toLowerCase())) {
      issues.push({
        code: "ntfs-prefix",
        severity: "warning",
        message: `The Proton prefix is on a non-POSIX filesystem (${mount.fsType}): ${mount.mountPoint}`,
        path: targetPath,
        mountPoint: mount.mountPoint,
        fsType: mount.fsType,
        remediation:
          "Move the Proton prefix or Steam library to a native Linux filesystem such as ext4 or btrfs; Wine requires reliable POSIX permissions and symlinks.",
      });
    }

    if (NETWORK_FS_TYPES.has(mount.fsType.toLowerCase())) {
      issues.push({
        code: "network-filesystem",
        severity: blockNetworkDeployment ? "error" : "warning",
        message: blockNetworkDeployment
          ? `Link-based deployment is unsafe on network filesystem ${mount.fsType}: ${mount.mountPoint}`
          : `The directory is on network filesystem ${mount.fsType}, where locking, file identity, and atomic operations may have reduced guarantees: ${mount.mountPoint}`,
        path: targetPath,
        mountPoint: mount.mountPoint,
        fsType: mount.fsType,
        remediation: blockNetworkDeployment
          ? "Move the game and staging directories to a local Linux filesystem before deploying mods."
          : "Use a local Linux filesystem for deployment and Proton data; keep network storage for archives or backups only.",
      });
    }
  }

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
      message: `The current user cannot write to: ${targetPath}`,
      path: targetPath,
      mountPoint: mount?.mountPoint,
      fsType: mount?.fsType,
      remediation:
        "Choose a writable directory or review the directory ownership and permissions with your system administrator.",
    });
  }

  return issues;
}

/** Hardlinks on POSIX require staging and the destination to have the same device ID. */
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
          "The staging and game directories are on different filesystem devices (EXDEV); hardlinks cannot cross disks or partitions.",
        path: stagingPath,
        remediation:
          "Move staging to the same filesystem as the game, or select Symlink Deployment.",
      };
    }
  } catch {
    // Do not block before both paths (or their nearest parents) can be inspected.
  }

  return undefined;
}

/** Ensure a deployment destination can hold the estimated copied data plus a safety reserve. */
export function checkAvailableDiskSpace(
  targetPath: string,
  requiredBytes: number,
  reserveBytes = MINIMUM_FREE_SPACE_RESERVE,
): IFileSystemIssue | undefined {
  try {
    let existingTarget = targetPath;
    while (!fs.existsSync(existingTarget) && existingTarget !== path.dirname(existingTarget)) {
      existingTarget = path.dirname(existingTarget);
    }

    const stats = fs.statfsSync(existingTarget);
    const availableBytes = stats.bavail * stats.bsize;
    if (requiredBytes + reserveBytes > availableBytes) {
      return {
        availableBytes,
        code: "insufficient-disk-space",
        message: `The deployment requires ${requiredBytes} bytes, but only ${availableBytes} bytes are available at ${targetPath}.`,
        path: targetPath,
        remediation:
          "Free disk space, move the game to a larger filesystem, or select a link-based deployment method.",
        requiredBytes,
        reserveBytes,
        severity: "error",
      };
    }
  } catch {
    // Do not block deployment when the platform cannot report filesystem capacity.
  }

  return undefined;
}

/**
 * Verify symbolic-link support with a short-lived probe inside the destination.
 * The probe is removed before this function returns, including after failures.
 */
export function checkSymlinkCompatibility(targetPath: string): IFileSystemIssue | undefined {
  let probeDirectory: string | undefined;
  try {
    let existingTarget = targetPath;
    while (!fs.existsSync(existingTarget) && existingTarget !== path.dirname(existingTarget)) {
      existingTarget = path.dirname(existingTarget);
    }
    if (!fs.statSync(existingTarget).isDirectory()) {
      throw new Error("The deployment destination is not a directory");
    }

    probeDirectory = fs.mkdtempSync(path.join(existingTarget, ".vortex-symlink-check-"));
    const source = path.join(probeDirectory, "source");
    const link = path.join(probeDirectory, "link");
    fs.writeFileSync(source, "probe");
    fs.symlinkSync(source, link);
    if (!fs.lstatSync(link).isSymbolicLink()) {
      throw new Error("The filesystem did not create a symbolic link");
    }
    return undefined;
  } catch (err) {
    return {
      code: "symlink-unavailable",
      message: `Symbolic links cannot be created at ${targetPath}: ${
        err instanceof Error ? err.message : "unknown filesystem error"
      }`,
      path: targetPath,
      remediation:
        "Choose another writable Linux filesystem or select a compatible deployment method.",
      severity: "error",
    };
  } finally {
    if (probeDirectory !== undefined) {
      try {
        fs.rmSync(probeDirectory, { force: true, recursive: true });
      } catch {
        // A failed cleanup is handled by the normal deployment filesystem diagnostics.
      }
    }
  }
}
