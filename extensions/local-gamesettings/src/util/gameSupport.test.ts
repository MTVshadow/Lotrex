import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterAll, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ discovery: undefined as any }));

vi.mock("@nexusmods/vortex-api", () => ({
  log: vi.fn(),
  selectors: { discoveryByGame: () => mocks.discovery },
  util: {
    getVortexPath: () => "/native/Documents",
    makeOverlayableDictionary: (base: any) => ({
      has: (gameId: string) => base[gameId] !== undefined,
      get: (gameId: string, key: string) => base[gameId][key],
    }),
  },
}));

import { initGameSupport, mygamesPath } from "./gameSupport";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-proton-documents-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

test("retries Proton resolution after game discovery becomes available", () => {
  initGameSupport({ store: { getState: () => ({}) } } as any);
  expect(mygamesPath("skyrimse")).toBe(
    path.join("/native/Documents", "My Games", "Skyrim Special Edition"),
  );

  const steamApps = path.join(root, "steamapps");
  const gamePath = path.join(steamApps, "common", "Skyrim Special Edition");
  const protonDocuments = path.join(
    steamApps,
    "compatdata",
    "489830",
    "pfx",
    "drive_c",
    "users",
    "steamuser",
    "Documents",
  );
  fs.mkdirSync(gamePath, { recursive: true });
  fs.mkdirSync(protonDocuments, { recursive: true });
  fs.writeFileSync(
    path.join(steamApps, "appmanifest_489830.acf"),
    '"AppState" { "installdir" "Skyrim Special Edition" }',
  );
  mocks.discovery = { path: gamePath, store: "steam" };

  expect(mygamesPath("skyrimse")).toBe(
    path.join(protonDocuments, "My Games", "Skyrim Special Edition"),
  );
});
