import * as nodeFs from "fs";
import * as os from "os";
import * as path from "path";

import { afterAll, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ discovery: undefined as any }));

vi.mock("@nexusmods/vortex-api", async () => {
  const { ProtonPaths } = await vi.importActual<any>(
    "../../../../src/renderer/src/util/linux/ProtonPaths",
  );
  return {
    fs: { readFileAsync: vi.fn(() => Promise.reject(new Error("not present"))) },
    log: vi.fn(),
    selectors: {
      discoveryByGame: () => mocks.discovery,
      gameById: () => undefined,
    },
    ProtonPaths,
    util: {
      getVortexPath: () => "/native/.config/Vortex",
      ProtonPaths,
      makeOverlayableDictionary: (base: any) =>
        Object.assign(base, {
          has: (gameId: string) => base[gameId] !== undefined,
          get: (gameId: string, key: string) => base[gameId][key],
        }),
    },
  };
});

vi.mock("./patternMatchNativePlugins", () => ({
  patternMatchNativePlugins: () => Promise.resolve([]),
}));

import { appDataPath, initGameSupport } from "./gameSupport";

const root = nodeFs.mkdtempSync(path.join(os.tmpdir(), "vortex-proton-appdata-"));
afterAll(() => nodeFs.rmSync(root, { recursive: true, force: true }));

test("uses the Proton prefix for the plugin list directory", async () => {
  const steamApps = path.join(root, "steamapps");
  const gamePath = path.join(steamApps, "common", "Skyrim Special Edition");
  const localAppData = path.join(
    steamApps,
    "compatdata",
    "489830",
    "pfx",
    "drive_c",
    "users",
    "steamuser",
    "AppData",
    "Local",
  );
  nodeFs.mkdirSync(gamePath, { recursive: true });
  nodeFs.mkdirSync(localAppData, { recursive: true });
  nodeFs.writeFileSync(
    path.join(steamApps, "appmanifest_489830.acf"),
    '"AppState" { "installdir" "Skyrim Special Edition" }',
  );
  mocks.discovery = { path: gamePath, store: "steam" };

  await initGameSupport({
    store: { getState: () => ({ settings: { gameMode: { discovered: {} } } }) },
  } as any);

  expect(appDataPath("skyrimse")).toBe(path.join(localAppData, "Skyrim Special Edition"));
});
