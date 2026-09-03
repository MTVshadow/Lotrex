import { describe, expect, it } from "vitest";

import { gamePlatformCapabilities, resolveGameSteamAppId } from "./gameCapabilities";

describe("resolveGameSteamAppId", () => {
  it("prefers the current platform capability", () => {
    expect(
      resolveGameSteamAppId(
        {
          capabilities: { platforms: { linux: { steamAppId: 489830 } } },
          details: { steamAppId: 1 },
          environment: { SteamAPPId: "2" },
          queryArgs: { steam: "3" },
        },
        "linux",
        "4",
      ),
    ).toBe("489830");
  });

  it("supports discovery, environment, legacy details and every queryArgs shape", () => {
    expect(resolveGameSteamAppId({}, "linux", 10)).toBe("10");
    expect(resolveGameSteamAppId({ environment: { SteamAPPId: "20" } }, "linux")).toBe("20");
    expect(resolveGameSteamAppId({ details: { steamAppId: 30 } }, "linux")).toBe("30");
    expect(resolveGameSteamAppId({ queryArgs: { steam: "40" } }, "linux")).toBe("40");
    expect(resolveGameSteamAppId({ queryArgs: { steam: { id: "50" } } }, "linux")).toBe("50");
    expect(resolveGameSteamAppId({ queryArgs: { steam: [{ id: "60" }] } }, "linux")).toBe("60");
  });

  it("does not apply Linux capabilities on another platform", () => {
    expect(
      resolveGameSteamAppId(
        {
          capabilities: { platforms: { linux: { steamAppId: 1 } } },
          queryArgs: { steam: "2" },
        },
        "win32",
      ),
    ).toBe("2");
  });

  it("resolves only capabilities for the active platform", () => {
    const game = {
      capabilities: {
        platforms: {
          linux: { launch: "steam-proton" as const, toolsInGamePrefix: true },
          win32: { launch: "native" as const },
        },
      },
    };

    expect(gamePlatformCapabilities(game, "linux")).toEqual({
      launch: "steam-proton",
      toolsInGamePrefix: true,
    });
    expect(gamePlatformCapabilities(game, "win32")).toEqual({ launch: "native" });
    expect(gamePlatformCapabilities(game, "freebsd")).toBeUndefined();
  });
});
