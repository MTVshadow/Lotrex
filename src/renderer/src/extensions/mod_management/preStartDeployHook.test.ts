import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkDeploymentRecoveryBeforeLaunch } from "./preStartDeployHook";
import {
  buildDeploymentRecoveryPlan,
  completeDeploymentRecovery,
  inspectDeploymentJournal,
} from "./util/deploymentJournal";
import { showDeploymentRecoveryDetails } from "./util/deploymentRecoveryUI";

vi.mock("../../util/selectors", () => ({ activeGameId: () => "gothic3" }));
vi.mock("./selectors", () => ({
  installPathForGame: () => "/staging/gothic3",
  needToDeploy: () => false,
}));
vi.mock("./util/activationStore", () => ({
  withActivationLock: (callback: () => unknown) => callback(),
}));
vi.mock("./util/deploymentJournal", () => ({
  buildDeploymentRecoveryPlan: vi.fn(),
  completeDeploymentRecovery: vi.fn(),
  inspectDeploymentJournal: vi.fn(),
}));
vi.mock("./util/deploymentRecoveryUI", () => ({
  showDeploymentRecoveryDetails: vi.fn(),
  translateWithFallback: (_translate: unknown, key: string) => key,
}));

const linuxIt = process.platform === "linux" ? it : it.skip;

describe("deployment recovery launch gate", () => {
  const state = { settings: { mods: { installPath: { gothic3: "/staging/gothic3" } } } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  linuxIt("blocks launch and offers inspection for a damaged journal", async () => {
    const inspection = {
      error: new Error("checksum mismatch"),
      stagingPath: "/staging/gothic3",
      status: "invalid" as const,
    };
    vi.mocked(inspectDeploymentJournal).mockResolvedValue(inspection);
    const api = {
      showDialog: vi.fn().mockResolvedValue({
        action: "mod_management:::deployment_recovery::action_details",
      }),
      store: { getState: () => state },
      translate: (key: string) => key,
    } as any;

    await expect(checkDeploymentRecoveryBeforeLaunch(api)).rejects.toBeDefined();
    expect(showDeploymentRecoveryDetails).toHaveBeenCalledWith(api, "gothic3", inspection);
    expect(completeDeploymentRecovery).not.toHaveBeenCalled();
  });

  linuxIt("continues only after a safe recovery clears the journal", async () => {
    const entry = {
      operation: "deploy",
      operationId: "operation-1",
      phase: "prepared",
      stagingPath: "/staging/gothic3",
    } as any;
    const inspection = {
      entry,
      stagingPath: entry.stagingPath,
      status: "incomplete" as const,
    };
    vi.mocked(inspectDeploymentJournal)
      .mockResolvedValueOnce(inspection)
      .mockResolvedValueOnce(undefined);
    vi.mocked(buildDeploymentRecoveryPlan).mockReturnValue({
      action: "rollback",
      affectedPaths: ["/games/Gothic 3"],
      operationId: entry.operationId,
      phase: entry.phase,
      reason: "No writes began.",
      safe: true,
    });
    const api = {
      showDialog: vi.fn().mockResolvedValue({
        action: "mod_management:::deployment_recovery::action_rollback",
      }),
      store: { getState: () => state },
      translate: (key: string) => key,
    } as any;

    await expect(checkDeploymentRecoveryBeforeLaunch(api)).resolves.toBeUndefined();
    expect(completeDeploymentRecovery).toHaveBeenCalledWith(entry, "rollback", undefined);
    expect(inspectDeploymentJournal).toHaveBeenCalledTimes(2);
  });
});
