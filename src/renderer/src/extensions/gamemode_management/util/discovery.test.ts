import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IGame } from "../../../types/IGame";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  identifyStore: vi.fn(),
  statAsync: vi.fn(),
  getNormalizeFunc: vi.fn(),
}));

vi.mock("../../../util/GameStoreHelper", () => ({
  default: {
    find: mocks.find,
    identifyStore: mocks.identifyStore,
  },
}));

vi.mock("../../../util/fs", () => ({
  statAsync: mocks.statAsync,
}));

vi.mock("../../../util/getNormalizeFunc", () => ({
  default: mocks.getNormalizeFunc,
}));

import { quickDiscovery } from "./discovery";

describe("quickDiscovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockResolvedValue([]);
    mocks.identifyStore.mockResolvedValue("steam");
    mocks.statAsync.mockResolvedValue({});
    mocks.getNormalizeFunc.mockResolvedValue((value: string) => value);
  });

  it("falls back to a custom queryPath when store lookup finds no installation", async () => {
    const installPath = "/games/example";
    const queryPath = vi.fn(() => installPath);
    const game = {
      id: "example",
      name: "Example",
      queryArgs: { steam: "123" },
      queryPath,
      executable: () => "example.exe",
      requiredFiles: [],
    } as unknown as IGame;
    const onDiscoveredGame = vi.fn();

    await expect(quickDiscovery([game], {}, onDiscoveredGame, vi.fn())).resolves.toEqual([
      "example",
    ]);

    expect(queryPath).toHaveBeenCalledOnce();
    expect(onDiscoveredGame).toHaveBeenCalledWith(
      "example",
      expect.objectContaining({ path: installPath, store: "steam" }),
    );
  });

  it("does not use queryPath when store lookup already found an installation", async () => {
    const installPath = "/games/example-from-store";
    const queryPath = vi.fn(() => "/games/custom-fallback");
    mocks.find.mockResolvedValue([{ gamePath: installPath, gameStoreId: "steam", priority: 1 }]);

    const game = {
      id: "example",
      name: "Example",
      queryArgs: { steam: "123" },
      queryPath,
      executable: () => "example.exe",
      requiredFiles: [],
    } as unknown as IGame;
    const onDiscoveredGame = vi.fn();

    await quickDiscovery([game], {}, onDiscoveredGame, vi.fn());

    expect(queryPath).not.toHaveBeenCalled();
    expect(onDiscoveredGame).toHaveBeenCalledWith(
      "example",
      expect.objectContaining({ path: installPath, store: "steam" }),
    );
  });
});
