import type { IGameDeploymentCapabilities } from "../../../types/IGame";
import type { IDeploymentMethod, IUnavailableReason } from "../types/IDeploymentMethod";

export interface IDeploymentMethodAssessment {
  activator: IDeploymentMethod;
  errors: IUnavailableReason[];
  warnings: IUnavailableReason[];
}

export interface IAutomaticDeploymentRecommendation {
  activator?: IDeploymentMethod;
  reason: string;
}

/** Rank already-assessed methods without repeating filesystem probes or relying on registration order. */
export function rankAutomaticDeploymentMethods(
  assessed: IDeploymentMethodAssessment[],
  platform: NodeJS.Platform,
  capabilities?: IGameDeploymentCapabilities,
): IAutomaticDeploymentRecommendation {
  const allowed = assessed.filter(({ activator, errors }) => {
    if (errors.length > 0) return false;
    if (platform === "linux" && activator.id === "move_activator" && capabilities?.move !== true) {
      return false;
    }
    if (activator.id === "hardlink_activator" && capabilities?.hardlink === false) return false;
    if (activator.id.includes("symlink") && capabilities?.symlink === false) return false;
    return true;
  });
  const clean = allowed.filter(({ warnings }) => warnings.length === 0);
  const candidates = clean.length > 0 ? clean : allowed;
  if (candidates.length === 0) {
    return { reason: "No compatible deployment method passed the environment checks." };
  }

  if (platform === "linux") {
    const hardlink = candidates.find(({ activator }) => activator.id === "hardlink_activator");
    if (hardlink !== undefined) {
      return {
        activator: hardlink.activator,
        reason: "Hardlinks are supported and staging shares a filesystem with the game.",
      };
    }
    const symlink = candidates.find(({ activator }) => activator.id.includes("symlink"));
    if (symlink !== undefined) {
      return {
        activator: symlink.activator,
        reason: "Symlinks are supported; hardlink requirements were not met.",
      };
    }
  }

  return {
    activator: candidates[0].activator,
    reason:
      candidates[0].warnings.length > 0
        ? "Selected the first compatible method, with non-blocking warnings."
        : "Selected the first compatible deployment method.",
  };
}
