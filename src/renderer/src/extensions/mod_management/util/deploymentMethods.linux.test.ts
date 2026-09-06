import { describe, expect, it } from "vitest";

import type { IDeploymentMethod } from "../types/IDeploymentMethod";
import { rankAutomaticDeploymentMethods } from "./deploymentRecommendation";

const method = (id: string) => ({ id, priority: 1 }) as IDeploymentMethod;
const ok = (id: string) => ({ activator: method(id), errors: [], warnings: [] });

describe("Linux automatic deployment selection", () => {
  it("prefers hardlinks when the filesystem assessment accepts them", () => {
    const result = rankAutomaticDeploymentMethods(
      [ok("symlink_activator"), ok("hardlink_activator")],
      "linux",
    );
    expect(result.activator?.id).toBe("hardlink_activator");
    expect(result.reason).toContain("shares a filesystem");
  });

  it("falls back to symlinks when hardlinks are blocked", () => {
    const hardlink = {
      activator: method("hardlink_activator"),
      errors: [{ description: (t: (value: string) => string) => t("cross-device") }],
      warnings: [],
    };
    const result = rankAutomaticDeploymentMethods([hardlink, ok("symlink_activator")], "linux");
    expect(result.activator?.id).toBe("symlink_activator");
    expect(result.reason).toContain("hardlink requirements");
  });

  it("does not offer move deployment unless the game opts in", () => {
    expect(
      rankAutomaticDeploymentMethods([ok("move_activator")], "linux").activator,
    ).toBeUndefined();
    expect(
      rankAutomaticDeploymentMethods([ok("move_activator")], "linux", { move: true }).activator?.id,
    ).toBe("move_activator");
  });
});
