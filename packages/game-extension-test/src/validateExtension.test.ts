import { describe, expect, it } from "vitest";

import { validateGameContract } from "./validateExtension";

const validGame = {
  executable: () => "Game.exe",
  id: "skyrimse",
  name: "Skyrim Special Edition",
  queryArgs: { steam: "489830" },
  queryModPath: () => "Data",
  requiredFiles: ["SkyrimSE.exe"],
  capabilities: {
    platforms: {
      linux: {
        launch: "steam-proton",
        steamAppId: 489830,
      },
    },
  },
};

describe("validateGameContract", () => {
  it("passes valid game specification with Linux capabilities", () => {
    const result = validateGameContract(validGame);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("flags missing mandatory fields", () => {
    const result = validateGameContract({
      id: "",
      name: "",
      requiredFiles: [],
    });

    expect(result.errors).toContain("Поле 'id' має бути непорожнім рядком.");
    expect(result.errors).toContain("Поле 'name' має бути непорожнім рядком.");
    expect(result.errors).toContain("Поле 'requiredFiles' має бути непорожнім масивом рядків.");
    expect(result.errors).toContain("Поле 'executable' має бути функцією.");
    expect(result.errors).toContain("Поле 'queryModPath' має бути функцією.");
  });

  it("flags absolute Windows-only paths returned by path functions", () => {
    const result = validateGameContract({
      ...validGame,
      executable: () => "C:\\Games\\Skyrim\\SkyrimSE.exe",
      queryModPath: () => "D:\\Mods",
    });

    expect(result.errors.some((e) => e.includes("C:\\"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Windows-шлях"))).toBe(true);
  });

  it("validates Linux platform capabilities", () => {
    const result = validateGameContract({
      ...validGame,
      capabilities: {
        platforms: {
          linux: {
            launch: "invalid-mode",
            steamAppId: true as any,
          },
        },
      },
    });

    expect(result.errors).toContain("Неприпустимий режим запуску для Linux: 'invalid-mode'.");
    expect(result.errors).toContain(
      "capabilities.platforms.linux.steamAppId має бути рядком або числом.",
    );
  });
});
