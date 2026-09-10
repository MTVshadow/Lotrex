/**
 * Unified Linux Resource Discovery — Common Result Contract (Phase 1)
 *
 * Освітній коментар:
 * Контракт уніфікованого результату пошуку ресурсів на Linux.
 * Жодне поле не використовує локалізований або перекладений текст як ідентифікатор:
 * ідентифікатори (id, kind, provider) є суворо детермінованими семантичними токенами.
 */

export type DiscoveredResourceKind =
  | "launcher"
  | "library"
  | "game"
  | "compatibility-runtime"
  | "compatibility-prefix"
  | "modding-tool"
  | "staging-folder"
  | "download-folder";

export type DiscoveryProviderId = "steam" | "heroic" | "lutris" | "system-xdg" | "custom-root";

export type PackagingFormat =
  | "native"
  | "flatpak"
  | "snap"
  | "appimage"
  | "nix"
  | "portable"
  | "unknown";

export type SandboxVisibility = "direct" | "portal" | "restricted" | "isolated";

export type DiscoveryConfidence = "confirmed" | "probable" | "user-confirmation-required";

export type DiscoveryValidationStatus =
  | "valid"
  | "invalid"
  | "permission-missing"
  | "missing-executable"
  | "corrupt";

export type DiscoveryEvidenceSourceType =
  | "xdg-spec"
  | "manifest"
  | "database"
  | "desktop-file"
  | "environment"
  | "uri-handler"
  | "user-approved-root";

export interface IDiscoveryPackagingContext {
  format: PackagingFormat;
  appId?: string;
  sandboxVisibility?: SandboxVisibility;
}

export interface IDiscoveryEvidence {
  sourceType: DiscoveryEvidenceSourceType;
  sourcePath: string;
  details?: Record<string, string | number | boolean>;
  timestamp: number;
}

export interface IDiscoveryValidation {
  status: DiscoveryValidationStatus;
  reasons?: string[];
}

export interface IDiscoveryRemediation {
  code: string;
  message: string;
  command?: string;
}

export interface IDiscoveredResource<TMetadata = Record<string, unknown>> {
  /** Унікальний стабільний ідентифікатор ресурсу, наприклад "steam:game:489830" */
  id: string;
  /** Тип ресурсу (лаунчер, гра, префікс, рантайм тощо) */
  kind: DiscoveredResourceKind;
  /** Ідентифікатор постачальника пошуку (steam, heroic, lutris тощо) */
  provider: DiscoveryProviderId;
  /** Нормалізований канонічний шлях у файловій системі */
  canonicalPath: string;
  /** Контекст пакування та видимість пісочниці */
  packagingContext: IDiscoveryPackagingContext;
  /** Масив перевірених свідчень походження ресурсу */
  evidence: IDiscoveryEvidence[];
  /** Рівень достовірності виявлення (confirmed, probable, user-confirmation-required) */
  confidence: DiscoveryConfidence;
  /** Поточний стан валідації ресурсу */
  validationState: IDiscoveryValidation;
  /** Часова мітка джерела у мілісекундах Epoch */
  sourceTimestamp: number;
  /** Структурована ремедіація у разі проблем валідації або дозволів */
  remediation?: IDiscoveryRemediation;
  /** Додаткові типізовані метадані (наприклад, AppID, ім'я для відображення тощо) */
  metadata?: TMetadata;
}

/**
 * Валідація коректності структури знайденого ресурсу за контрактом Phase 1.
 */
export function validateDiscoveredResource(resource: unknown): resource is IDiscoveredResource {
  if (!resource || typeof resource !== "object") return false;
  const res = resource as Partial<IDiscoveredResource>;

  if (typeof res.id !== "string" || res.id.trim().length === 0) return false;
  if (typeof res.canonicalPath !== "string" || !res.canonicalPath.startsWith("/")) return false;
  if (!res.kind || typeof res.kind !== "string") return false;
  if (!res.provider || typeof res.provider !== "string") return false;
  if (!res.packagingContext || typeof res.packagingContext.format !== "string") return false;
  if (!Array.isArray(res.evidence) || res.evidence.length === 0) return false;
  if (!res.confidence || typeof res.confidence !== "string") return false;
  if (!res.validationState || typeof res.validationState.status !== "string") return false;
  if (typeof res.sourceTimestamp !== "number" || isNaN(res.sourceTimestamp)) return false;

  return true;
}
