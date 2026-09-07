import { getErrorCode, getErrorMessageOrDefault } from "@vortex/shared";

/**
 * Структурований опис помилки файлової системи для зрозумілого інформування користувача Linux.
 */
export interface IStructuredFilesystemError {
  /** Короткий заголовок помилки для діалогового вікна або сповіщення */
  title: string;
  /** Технічна назва проблеми (наприклад, "Cross-device link") */
  problemName: string;
  /** Оригінальний код помилки операційної системи (EXDEV, EACCES, EROFS, ENOSPC тощо) */
  code: string;
  /** Вхідний або вихідний шлях (якщо відомо) */
  sourcePath?: string;
  destPath?: string;
  /** Поточний активний метод розгортання ("hardlink", "symlink", "move") */
  activeMethod?: string;
  /** Альтернативний рекомендований метод (якщо є) */
  fallbackMethod?: string;
  /** Детальний опис проблеми */
  message: string;
  /** Практичні інструкції з виправлення */
  remediation: string;
  /** Чи потрібно запропонувати відкрити налаштування Vortex для виправлення */
  openSettingsAction: boolean;
}

export interface IFilesystemErrorContext {
  sourcePath?: string;
  destPath?: string;
  activeMethod?: string;
}

const FATAL_DEPLOYMENT_FILESYSTEM_CODES = new Set([
  "EIO",
  "ENODEV",
  "ENXIO",
  "EREMOTEIO",
  "EROFS",
  "ESTALE",
]);

/** Storage-level failures must abort the whole transaction so its journal remains recoverable. */
export function isFatalDeploymentFilesystemError(err: unknown): boolean {
  return FATAL_DEPLOYMENT_FILESYSTEM_CODES.has(getErrorCode(err));
}

/**
 * Перетворює низькорівневі винятки файлової системи Linux (EXDEV, EACCES, EROFS, ENOSPC)
 * у структуровані помилки зі зрозумілими інструкціями щодо вирішення.
 */
export function translateFilesystemError(
  err: unknown,
  context: IFilesystemErrorContext = {},
): IStructuredFilesystemError {
  const code = getErrorCode(err) || "UNKNOWN";
  const rawMessage = getErrorMessageOrDefault(err);
  const { sourcePath, destPath, activeMethod } = context;

  switch (code) {
    case "EXDEV":
      return {
        title: "Hardlink deployment crosses filesystems",
        problemName: "Cross-device link (EXDEV)",
        code,
        sourcePath,
        destPath,
        activeMethod,
        fallbackMethod: activeMethod === "hardlink" ? "symlink" : undefined,
        message: "Linux hardlinks can only be created within one filesystem.",
        remediation:
          "Move the Mod Staging folder to the game's filesystem or select the supported Symlink deployment method in Settings -> Mods.",
        openSettingsAction: true,
      };

    case "EROFS":
      return {
        title: "Filesystem is read-only",
        problemName: "Read-only file system (EROFS)",
        code,
        sourcePath,
        destPath,
        activeMethod,
        message: "The game or staging directory is on a filesystem mounted read-only.",
        remediation:
          "Mount the filesystem with write access or move the game and staging folders to a writable location.",
        openSettingsAction: false,
      };

    case "EACCES":
    case "EPERM":
      return {
        title: "Directory access denied",
        problemName: "Permission denied (EACCES/EPERM)",
        code,
        sourcePath,
        destPath,
        activeMethod,
        message: "Vortex cannot create or modify files in the destination directory.",
        remediation:
          "Correct the ownership or user permissions for the affected directory without granting broader access than necessary.",
        openSettingsAction: false,
      };

    case "ENOSPC":
      return {
        title: "Not enough free disk space",
        problemName: "No space left on device (ENOSPC)",
        code,
        sourcePath,
        destPath,
        activeMethod,
        message: "The destination filesystem has no space left to finish deployment.",
        remediation: "Free space on the affected filesystem and retry deployment.",
        openSettingsAction: false,
      };

    default:
      return {
        title: "Filesystem error",
        problemName: `Filesystem Error (${code})`,
        code,
        sourcePath,
        destPath,
        activeMethod,
        message: rawMessage,
        remediation: "Check the filesystem state and access permissions for the affected paths.",
        openSettingsAction: false,
      };
  }
}
