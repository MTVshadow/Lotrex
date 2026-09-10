import * as fs from "node:fs";
import * as path from "node:path";

import type {
  DiscoveryConfidence,
  DiscoveryValidationStatus,
  IDiscoveryValidation,
} from "./contracts";

export interface ICandidateValidationOptions {
  requireExecutable?: boolean;
  requiredSubpaths?: string[];
  manifestOwned?: boolean;
  providerCount?: number;
}

export interface ICandidateValidationResult {
  validationState: IDiscoveryValidation;
  confidence: DiscoveryConfidence;
  hasExecutableIdentity: boolean;
  directoryValid: boolean;
}

/**
 * Валідація кандидата пошуку та визначення рівня довіри (Phase 4).
 *
 * Освітній коментар:
 * Знайдені бінарні файли та каталоги ніколи не приймаються на віру сліпо (never trust implicitly).
 * Перевіряється:
 * 1. Фізична присутність та відсутність завислих (dangling) симлінків.
 * 2. Дозволи на читання (R_OK) та виконання (X_OK).
 * 3. Ненульовий розмір і валідний заголовок файлу (ELF, PE MZ, чи shebang #!).
 * 4. Наявність обов'язкових підкаталогів/файлів структури.
 * 5. Узгодженість маніфестів і незалежне підтвердження постачальниками.
 */
export function validateResourceCandidate(
  targetPath: string,
  options: ICandidateValidationOptions = {},
): ICandidateValidationResult {
  const reasons: string[] = [];
  const normPath = path.resolve(targetPath);
  const {
    requireExecutable = false,
    requiredSubpaths = [],
    manifestOwned = false,
    providerCount = 1,
  } = options;

  let hasExecutableIdentity = false;
  let directoryValid = true;

  // 1. Перевірка існування та виявлення завислих симлінків
  try {
    const lstat = fs.lstatSync(normPath);
    if (lstat.isSymbolicLink()) {
      try {
        fs.statSync(normPath); // Перевірка реального таргета симлінка
      } catch {
        return {
          validationState: {
            status: "invalid",
            reasons: ["Target is a dangling or broken symbolic link"],
          },
          confidence: "user-confirmation-required",
          hasExecutableIdentity: false,
          directoryValid: false,
        };
      }
    }
  } catch {
    return {
      validationState: {
        status: requireExecutable ? "missing-executable" : "invalid",
        reasons: [`Target path does not exist: ${normPath}`],
      },
      confidence: "user-confirmation-required",
      hasExecutableIdentity: false,
      directoryValid: false,
    };
  }

  // 2. Перевірка прав доступу на читання
  try {
    fs.accessSync(normPath, fs.constants.R_OK);
  } catch {
    return {
      validationState: {
        status: "permission-missing",
        reasons: [`Read permission denied for path: ${normPath}`],
      },
      confidence: "user-confirmation-required",
      hasExecutableIdentity: false,
      directoryValid: false,
    };
  }

  const stat = fs.statSync(normPath);

  // 3. Якщо це каталог — перевірка структури
  if (stat.isDirectory()) {
    for (const subpath of requiredSubpaths) {
      const fullSubpath = path.join(normPath, subpath);
      if (!fs.existsSync(fullSubpath)) {
        directoryValid = false;
        reasons.push(`Required subdirectory or file missing: ${subpath}`);
      } else {
        try {
          const subStat = fs.statSync(fullSubpath);
          if (subStat.isFile()) {
            fs.accessSync(fullSubpath, fs.constants.X_OK);
            hasExecutableIdentity = true;
          }
        } catch {
          // Файл не має прав виконання
        }
      }
    }
  }

  // 4. Якщо це виконуваний файл або вимагається перевірка виконуваного файлу
  if (stat.isFile() || requireExecutable) {
    if (!stat.isFile()) {
      return {
        validationState: {
          status: "missing-executable",
          reasons: [`Expected an executable file, but found a directory: ${normPath}`],
        },
        confidence: "user-confirmation-required",
        hasExecutableIdentity: false,
        directoryValid,
      };
    }

    // Перевірка розміру (нульовий файл — пошкоджений)
    if (stat.size === 0) {
      return {
        validationState: {
          status: "corrupt",
          reasons: ["Executable file has 0 bytes size"],
        },
        confidence: "user-confirmation-required",
        hasExecutableIdentity: false,
        directoryValid,
      };
    }

    // Перевірка прав на виконання (X_OK)
    try {
      fs.accessSync(normPath, fs.constants.X_OK);
    } catch {
      return {
        validationState: {
          status: "permission-missing",
          reasons: ["File does not have executable permissions (X_OK)"],
        },
        confidence: "user-confirmation-required",
        hasExecutableIdentity: false,
        directoryValid,
      };
    }

    // Перевірка сигнатури заголовка виконуваного файлу
    try {
      const fd = fs.openSync(normPath, "r");
      const buffer = Buffer.alloc(4);
      fs.readSync(fd, buffer, 0, 4, 0);
      fs.closeSync(fd);

      const isElf = buffer[0] === 0x7f && buffer.toString("ascii", 1, 4) === "ELF";
      const isShebang = buffer[0] === 0x23 && buffer[1] === 0x21; // #!
      const isPe = buffer[0] === 0x4d && buffer[1] === 0x5a; // MZ

      if (isElf || isShebang || isPe) {
        hasExecutableIdentity = true;
      } else {
        reasons.push("File does not match standard executable headers (ELF, Shebang, PE MZ)");
      }
    } catch {
      reasons.push("Failed to read candidate file header");
    }
  }

  // 5. Визначення фінального статусу валідації
  let status: DiscoveryValidationStatus = "valid";
  if (reasons.length > 0) {
    status = requireExecutable && !hasExecutableIdentity ? "invalid" : "valid";
  }

  // 6. Класифікація рівня достовірності (Confidence)
  let confidence: DiscoveryConfidence = "user-confirmation-required";
  if (status === "valid" && directoryValid) {
    if (hasExecutableIdentity || (manifestOwned && providerCount >= 1)) {
      confidence = "confirmed";
    } else if (manifestOwned || providerCount > 1) {
      confidence = "confirmed";
    } else {
      confidence = "probable";
    }
  }

  return {
    validationState: {
      status,
      reasons: reasons.length > 0 ? reasons : undefined,
    },
    confidence,
    hasExecutableIdentity,
    directoryValid,
  };
}
