import * as path from "node:path";

import type { IExtensionApi } from "@/types/IExtensionContext";
import {
  HealthCheckCategory,
  HealthCheckSeverity,
  HealthCheckTrigger,
  type IHealthCheck,
  type IHealthCheckResult,
} from "@/types/IHealthCheck";
import { assessLinuxEnvironment } from "@/util/linux/environmentAssessment";
import { findLatestProton } from "@/util/linux/proton";
import ProtonPaths from "@/util/linux/ProtonPaths";
import { findLinuxSteamPath } from "@/util/linux/steamPaths";
import { activeGameId, discoveryByGame, gameById } from "@/util/selectors";

import { getGame } from "../../gamemode_management/util/getGame";
import { installPathForGame } from "../../mod_management/selectors";
import type { ILinuxProtonCheckMetadata, ILinuxProtonIssue } from "../types";
import { assessLinuxProton } from "./linuxProtonAssessment";

export const LINUX_PROTON_CHECK_ID = "check-linux-proton";

const result = (
  startedAt: number,
  issues: ILinuxProtonIssue[] = [],
): IHealthCheckResult<ILinuxProtonCheckMetadata> => ({
  checkId: LINUX_PROTON_CHECK_ID,
  executionTime: Date.now() - startedAt,
  message: issues.length > 0 ? "Linux environment needs attention" : "Linux environment is ready",
  metadata: { issue: issues[0], issues },
  severity: issues.some((issue) => issue.severity === "error")
    ? HealthCheckSeverity.Error
    : issues.length > 0
      ? HealthCheckSeverity.Warning
      : HealthCheckSeverity.Info,
  status: issues.length > 0 ? "warning" : "passed",
  timestamp: new Date(),
});

export async function checkLinuxProton(
  api: IExtensionApi,
): Promise<IHealthCheckResult<ILinuxProtonCheckMetadata>> {
  const startedAt = Date.now();
  const state = api.getState();
  const gameId = activeGameId(state);
  if (!gameId) return result(startedAt);

  const discovery = discoveryByGame(state, gameId);
  const game = gameById(state, gameId);
  const runtimeGame = getGame(gameId);
  const executable = discovery?.executable ?? game?.executable;
  const executablePath =
    discovery?.path && executable ? path.join(discovery.path, executable) : undefined;
  const appId = ProtonPaths.resolveAppId(discovery, game);
  const prefixPath = ProtonPaths.resolvePrefixPath(discovery, appId);
  const steamPath = findLinuxSteamPath();
  const protonPath = steamPath ? await findLatestProton(steamPath, appId) : undefined;
  const stagingPath = installPathForGame(state, gameId);
  const deploymentPaths =
    discovery?.path && runtimeGame?.getModPaths
      ? Object.values(runtimeGame.getModPaths(discovery.path)).filter(
          (entry): entry is string => typeof entry === "string" && entry.length > 0,
        )
      : [];
  const environment = assessLinuxEnvironment({
    deploymentMethodId: state.settings.mods.activator?.[gameId],
    deploymentPaths,
    gamePath: discovery?.path,
    platform: process.platform,
    prefixPath,
    stagingPath,
    steamPath,
  });
  const protonIssue = assessLinuxProton({
    appId,
    executablePath,
    gameName: discovery?.name ?? game?.name,
    platform: process.platform,
    prefixPath,
    protonPath,
    steamPath,
    store: discovery?.store,
  });

  return result(startedAt, [
    ...(protonIssue ? [protonIssue] : []),
    ...environment.issues.map((issue) => ({
      ...issue,
      gameName: discovery?.name ?? game?.name,
      reason: issue.code,
    })),
  ]);
}

export const linuxProtonHealthCheck: IHealthCheck = {
  category: HealthCheckCategory.System,
  check: checkLinuxProton,
  description: "Validates Steam and Proton setup for the active Linux game",
  id: LINUX_PROTON_CHECK_ID,
  name: "Linux Proton",
  severity: HealthCheckSeverity.Warning,
  triggers: [HealthCheckTrigger.Startup, HealthCheckTrigger.GameChanged, HealthCheckTrigger.Manual],
};
