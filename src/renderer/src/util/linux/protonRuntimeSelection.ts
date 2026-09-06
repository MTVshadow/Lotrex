import {
  type IProtonRuntimeOption,
  type ICustomProtonValidationOptions,
  type ProtonRuntimeType,
  validateCustomProtonPath,
} from "./protonRuntimes";

export interface IProtonRuntimePreference {
  approvedPath?: string;
  path?: string;
  type: ProtonRuntimeType;
}

export interface IResolvedProtonRuntimePreference {
  error?: string;
  path?: string;
  type: ProtonRuntimeType;
}

/** Resolve a persisted UI choice against runtimes that are installed right now. */
export function resolveProtonRuntimePreference(
  preference: IProtonRuntimePreference | undefined,
  steamSelectedPath: string | undefined,
  installed: IProtonRuntimeOption[],
  customValidation?: ICustomProtonValidationOptions,
): IResolvedProtonRuntimePreference {
  const type = preference?.type ?? "auto";
  if (type === "auto") return { type, path: undefined };

  if (type === "steam-selected") {
    return steamSelectedPath
      ? { type, path: steamSelectedPath }
      : {
          type,
          error: "Steam's selected Proton runtime is not installed or could not be resolved.",
        };
  }

  if (type === "custom") {
    const validation = validateCustomProtonPath(preference?.path ?? "", {
      ...customValidation,
      approvedPath: preference?.approvedPath,
    });
    return validation.valid ? { type, path: preference?.path } : { type, error: validation.error };
  }

  const matches = installed.filter((runtime) => runtime.type === type && runtime.isUsable);
  const preferred = preference?.path
    ? matches.find((runtime) => runtime.path === preference.path)
    : matches[0];
  return preferred
    ? { type, path: preferred.path }
    : {
        type,
        error: `No usable ${type === "ge-proton" ? "GE-Proton" : "Proton Experimental"} runtime was found.`,
      };
}
