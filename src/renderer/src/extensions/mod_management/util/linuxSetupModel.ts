import type { ILinuxEnvironmentIssue } from "../../../util/linux/environmentAssessment";
import type { IProtonRuntimePreference } from "../../../util/linux/protonRuntimeSelection";

export type SteamInstallationType = "Flatpak" | "Native" | "Not detected" | "Snap";

export function detectSteamInstallationType(steamPath?: string): SteamInstallationType {
  if (steamPath === undefined) return "Not detected";

  const normalized = steamPath.replaceAll("\\", "/");
  if (normalized.includes("/.var/app/")) return "Flatpak";
  if (normalized.includes("/snap/")) return "Snap";
  return "Native";
}

export function runtimePreferenceValue(preference?: IProtonRuntimePreference): string {
  return preference?.path ? `runtime:${preference.path}` : (preference?.type ?? "auto");
}

export function configurationProblems(
  issues: ILinuxEnvironmentIssue[],
  prefixPath?: string,
  runtimeError?: string,
): string[] {
  return [
    ...issues.map((issue) => `${issue.severity.toUpperCase()}: ${issue.message}`),
    ...(prefixPath ? [] : ["ERROR: Proton prefix was not detected."]),
    ...(runtimeError ? [`ERROR: ${runtimeError}`] : []),
  ];
}
