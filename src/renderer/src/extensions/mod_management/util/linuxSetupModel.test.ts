import { describe, expect, it } from "vitest";

import {
  configurationProblems,
  detectSteamInstallationType,
  runtimePreferenceValue,
} from "./linuxSetupModel";

describe("Linux setup assistant model", () => {
  it.each([
    [undefined, "Not detected"],
    ["/home/user/.steam/root", "Native"],
    ["/home/user/.var/app/com.valvesoftware.Steam/data/Steam", "Flatpak"],
    ["/home/user/snap/steam/common/.steam", "Snap"],
  ])("classifies Steam installation %s", (steamPath, expected) => {
    expect(detectSteamInstallationType(steamPath)).toBe(expected);
  });

  it("maps automatic, named, and path runtime preferences to select values", () => {
    expect(runtimePreferenceValue()).toBe("auto");
    expect(runtimePreferenceValue({ type: "steam-selected" })).toBe("steam-selected");
    expect(runtimePreferenceValue({ path: "/opt/proton", type: "custom" })).toBe(
      "runtime:/opt/proton",
    );
  });

  it("combines environment, prefix, and runtime failures", () => {
    expect(
      configurationProblems(
        [
          {
            code: "permission-denied",
            message: "Game directory is not writable",
            path: "/games/example",
            purpose: "game",
            severity: "error",
          },
        ],
        undefined,
        "Selected Proton runtime is missing",
      ),
    ).toEqual([
      "ERROR: Game directory is not writable",
      "ERROR: Proton prefix was not detected.",
      "ERROR: Selected Proton runtime is missing",
    ]);
  });

  it("reports no problems for a healthy configuration", () => {
    expect(configurationProblems([], "/steam/compatdata/489830/pfx")).toEqual([]);
  });
});
