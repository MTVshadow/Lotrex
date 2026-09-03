/**
 * Фільтрація та адаптація інструкцій та порад під конкретну ОС (Linux vs Windows).
 * На Linux неприпустимо показувати поради штибу "Запустіть як Адміністратор", "Вимкніть Windows Defender",
 * "Змініть диск C: на D:" або звернення до реєстру Windows.
 */

export function sanitizePlatformMessage(
  text: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "linux" || !text) {
    return text;
  }

  let result = text;

  // 1. Заміна порад щодо запуску від імені адміністратора
  result = result.replace(
    /run(?:\s+\w+)?\s+as\s+administrator/gi,
    "verify folder permissions (chmod/chown)",
  );
  result = result.replace(/administrator\s+privileges/gi, "appropriate Linux user permissions");

  // 2. Заміна порад щодо антивірусів Windows / Windows Defender
  result = result.replace(
    /windows\s+defender(?:\s+exclusions?)?/gi,
    "Linux filesystem permissions or security policies",
  );
  result = result.replace(
    /antivirus\s+whitelist(?:ing)?/gi,
    "filesystem mount options and permissions",
  );

  // 3. Заміна термінології дисків Windows на розділи/монтування
  result = result.replace(/same\s+drive(?:\s+letter)?/gi, "same filesystem partition");
  result = result.replace(/drive\s+letter/gi, "mount point");

  // 4. Заміна звернень до Windows Registry
  result = result.replace(/windows\s+registry/gi, "Wine prefix registry (user.reg)");

  return result;
}

export interface IRemediationAdvice {
  code: string;
  title: string;
  message: string;
  remediation: string;
  commandSnippet?: string;
}

/**
 * Отримання платформово-адаптованої поради щодо вирішення проблеми.
 */
export function getPlatformRemediation(
  issueCode: string,
  context: { path?: string; appId?: string } = {},
  platform: NodeJS.Platform = process.platform,
): IRemediationAdvice {
  if (platform !== "linux") {
    return {
      code: issueCode,
      title: "File access issue",
      message: "An issue occurred accessing the file or folder.",
      remediation: "Ensure you have administrator permissions and check your antivirus settings.",
    };
  }

  switch (issueCode) {
    case "permission-denied":
    case "EACCES":
    case "EPERM":
      return {
        code: issueCode,
        title: "Помилка доступу до каталогу",
        message: `Vortex не має прав запису до каталогу: ${context.path || "вказаний шлях"}`,
        remediation:
          "Перевірте власника каталогу та права доступу. Не запускайте Vortex через sudo.",
        commandSnippet: context.path ? `chown -R $USER:$USER "${context.path}"` : undefined,
      };

    case "cross-device-hardlink":
    case "EXDEV":
      return {
        code: issueCode,
        title: "Розбіжність розділів файлової системи",
        message:
          "Каталог модів (staging) та гра розташовані на різних точках монтування файлової системи.",
        remediation:
          "Хардлінки в Linux підтримуються лише в межах одного розділу. Перенесіть staging на той самий розділ або увімкніть Symlink Deployment.",
      };

    case "antivirus-blocked":
      return {
        code: issueCode,
        title: "Блокування виконання бінарного файлу",
        message:
          "Файлова система не дозволяє виконання файлів або відсутні права на виконання (+x).",
        remediation:
          "Перевірте, чи не змонтовано розділ з опцією 'noexec' у /etc/fstab, та додайте права на виконання.",
        commandSnippet: context.path ? `chmod +x "${context.path}"` : undefined,
      };

    default:
      return {
        code: issueCode,
        title: "Діагностичне повідомлення",
        message: `Виявлено системну подію: ${issueCode}`,
        remediation: "Перевірте журнали Vortex у ~/.config/Vortex/logs для деталей.",
      };
  }
}
