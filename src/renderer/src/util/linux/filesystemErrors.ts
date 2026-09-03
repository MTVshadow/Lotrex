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
        title: "Неможливо створити хардлінк між різними дисками",
        problemName: "Cross-device link (EXDEV)",
        code,
        sourcePath,
        destPath,
        activeMethod,
        fallbackMethod: activeMethod === "hardlink" ? "symlink" : undefined,
        message:
          "Хардлінки в Linux підтримуються лише в межах одного розділу/диска файлової системи. Спроба зв'язати файли між різними дисками призводить до системної помилки EXDEV.",
        remediation:
          "Перейдіть у Налаштування -> Моди та вкажіть каталог Mod Staging на тому ж розділі диска, де встановлена гра, або змініть метод розгортання на 'Symlink'.",
        openSettingsAction: true,
      };

    case "EROFS":
      return {
        title: "Файлова система доступна лише для читання",
        problemName: "Read-only file system (EROFS)",
        code,
        sourcePath,
        destPath,
        activeMethod,
        message:
          "Розділ або диск, де розташована гра чи каталог модів, змонтований у режимі лише для читання (ro).",
        remediation:
          "Перемонтуйте розділ із правами запису (sudo mount -o remount,rw <mountpoint>) або перевірте параметри розділу у файлі /etc/fstab.",
        openSettingsAction: false,
      };

    case "EACCES":
    case "EPERM":
      return {
        title: "Відмовлено в доступі до каталогу",
        problemName: "Permission denied (EACCES/EPERM)",
        code,
        sourcePath,
        destPath,
        activeMethod,
        message:
          "Vortex не має достатніх прав для створення або зміни файлів у каталозі призначення.",
        remediation:
          "Перевірте права власності на каталог гри або staging (наприклад, chown -R $USER:$USER <директорія>) та дозволи запису (chmod -R u+rwX <директорія>).",
        openSettingsAction: false,
      };

    case "ENOSPC":
      return {
        title: "Недостатньо вільного місця на диску",
        problemName: "No space left on device (ENOSPC)",
        code,
        sourcePath,
        destPath,
        activeMethod,
        message: "На цільовому диску вичерпано вільне місце для завершення розгортання файлів.",
        remediation: "Звільніть місце на відповідному диску та спробуйте повторити операцію.",
        openSettingsAction: false,
      };

    default:
      return {
        title: "Помилка файлової системи",
        problemName: `Filesystem Error (${code})`,
        code,
        sourcePath,
        destPath,
        activeMethod,
        message: rawMessage,
        remediation:
          "Перевірте стан файлової системи та наявність прав доступу до зазначених файлів.",
        openSettingsAction: false,
      };
  }
}
