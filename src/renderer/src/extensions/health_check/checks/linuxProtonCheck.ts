import * as path from "node:path";

import type { IExtensionApi } from "@/types/IExtensionContext";
import {
  HealthCheckCategory,
  HealthCheckSeverity,
  HealthCheckTrigger,
  type IHealthCheck,
  type IHealthCheckResult,
} from "@/types/IHealthCheck";
import { findLatestProton } from "@/util/linux/proton";
import ProtonPaths from "@/util/linux/ProtonPaths";
import { findLinuxSteamPath } from "@/util/linux/steamPaths";
import { activeGameId, discoveryByGame, gameById } from "@/util/selectors";

import type { ILinuxProtonCheckMetadata, ILinuxProtonIssue } from "../types";
import { assessLinuxProton } from "./linuxProtonAssessment";

export const LINUX_PROTON_CHECK_ID = "check-linux-proton";

const result = (
  startedAt: number,
  issue?: ILinuxProtonIssue,
): IHealthCheckResult<ILinuxProtonCheckMetadata> => ({
  checkId: LINUX_PROTON_CHECK_ID,
  executionTime: Date.now() - startedAt,
  message: issue ? "Proton setup needs attention" : "Steam and Proton are ready",
  metadata: { issue },
  severity: issue ? HealthCheckSeverity.Warning : HealthCheckSeverity.Info,
  status: issue ? "warning" : "passed",
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
  const executable = discovery?.executable ?? game?.executable;
  const executablePath =
    discovery?.path && executable ? path.join(discovery.path, executable) : undefined;
  const appId = ProtonPaths.resolveAppId(discovery, game);
  const prefixPath = ProtonPaths.resolvePrefixPath(discovery, appId);
  const steamPath = findLinuxSteamPath();
  const protonPath = steamPath ? await findLatestProton(steamPath, appId) : undefined;

  return result(
    startedAt,
    assessLinuxProton({
      appId,
      executablePath,
      gameName: discovery?.name ?? game?.name,
      platform: process.platform,
      prefixPath,
      protonPath,
      steamPath,
      store: discovery?.store,
    }),
  );
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
