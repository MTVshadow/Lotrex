import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { IDiscoveryResult } from "../../../extensions/gamemode_management/types/IDiscoveryResult";
import type { IGameStored } from "../../../extensions/gamemode_management/types/IGameStored";
import type { IProfile } from "../../../extensions/profile_management/types/IProfile";
import { buildLegacyUnifiedLibrary } from "./legacyGameBridge";

describe("legacy game architecture bridge", () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("adapts real Vortex discovery and profile state without replacing it", () => {
    const installPath = fs.mkdtempSync(path.join(os.tmpdir(), "lotrex-legacy-bridge-"));
    temporaryRoots.push(installPath);
    fs.writeFileSync(path.join(installPath, "game.exe"), "MZ");

    const games: IGameStored[] = [
      {
        id: "example-game",
        name: "Example Game",
        executable: "game.exe",
        requiredFiles: ["game.exe"],
        capabilities: {
          deployment: { hardlink: true, symlink: true },
          platforms: { linux: { launch: "steam-proton", steamAppId: "1234" } },
        },
      },
    ];
    const discoveries: Record<string, IDiscoveryResult> = {
      "example-game": { path: installPath, store: "steam" },
    };
    const profiles: Record<string, IProfile> = {
      profile1: {
        id: "profile1",
        gameId: "example-game",
        name: "Default",
        lastActivated: 10,
        modState: {},
      },
    };

    const result = buildLegacyUnifiedLibrary(games, discoveries, profiles);

    expect(result.installations).toHaveLength(1);
    expect(result.installations[0]).toMatchObject({
      installPath,
      executablePath: path.join(installPath, "game.exe"),
      profileId: "profile1",
      identity: {
        gameId: "example-game",
        platform: "windows-proton",
        storeId: "steam",
        storeAppId: "1234",
      },
    });
    expect(result.adapterRegistry.getAdapterForGame("example-game", "default")).toBeDefined();
  });

  it("does not expose hidden or undiscovered games", () => {
    const games: IGameStored[] = [
      { id: "hidden", name: "Hidden", executable: "hidden", requiredFiles: [] },
      { id: "missing", name: "Missing", executable: "missing", requiredFiles: [] },
    ];

    const result = buildLegacyUnifiedLibrary(
      games,
      { hidden: { path: "/games/hidden", hidden: true } },
      {},
    );

    expect(result.installations).toEqual([]);
    expect(result.adapterRegistry.listAdapters()).toEqual([]);
  });

  it("keeps a provider-owned installation ID stable after its library path changes", () => {
    const firstPath = fs.mkdtempSync(path.join(os.tmpdir(), "lotrex-provider-first-"));
    const movedPath = fs.mkdtempSync(path.join(os.tmpdir(), "lotrex-provider-moved-"));
    temporaryRoots.push(firstPath, movedPath);
    fs.writeFileSync(path.join(firstPath, "game.exe"), "MZ");
    fs.writeFileSync(path.join(movedPath, "game.exe"), "MZ");

    const games: IGameStored[] = [
      {
        id: "relocated-game",
        name: "Relocated Game",
        executable: "game.exe",
        requiredFiles: ["game.exe"],
        capabilities: {
          platforms: { linux: { launch: "steam-proton", steamAppId: "5678" } },
        },
      },
    ];

    const before = buildLegacyUnifiedLibrary(
      games,
      { "relocated-game": { path: firstPath, store: "steam" } },
      {},
    );
    const after = buildLegacyUnifiedLibrary(
      games,
      { "relocated-game": { path: movedPath, store: "steam" } },
      {},
    );

    expect(after.installations[0].installationId).toBe(before.installations[0].installationId);
  });

  it("keeps manual discoveries path-bound when no provider identity exists", () => {
    const games: IGameStored[] = [
      { id: "manual-game", name: "Manual Game", executable: "game", requiredFiles: [] },
    ];

    const before = buildLegacyUnifiedLibrary(
      games,
      { "manual-game": { path: "/games/first", pathSetManually: true } },
      {},
    );
    const after = buildLegacyUnifiedLibrary(
      games,
      { "manual-game": { path: "/games/moved", pathSetManually: true } },
      {},
    );

    expect(after.installations[0].installationId).not.toBe(before.installations[0].installationId);
  });
});
