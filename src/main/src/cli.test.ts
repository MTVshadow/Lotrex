import { beforeEach, describe, expect, it, vi } from "vitest";

const { mkdirSync, readFileSync, writeFileSync } = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({ mkdirSync, readFileSync, writeFileSync }));
vi.mock("electron", () => ({
  app: { name: "Vortex", getVersion: vi.fn(() => "1.0.0") },
  BrowserWindow: {},
}));
vi.mock("./getVortexPath", () => ({ getVortexPath: vi.fn(() => "/tmp/vortex-config") }));
vi.mock("./logging", () => ({ log: vi.fn() }));

import { updateStartupSettings } from "./cli";

describe("updateStartupSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileSync.mockImplementation(() => {
      throw new Error("missing startup settings");
    });
  });

  it("creates the settings directory before writing on a clean install", () => {
    updateStartupSettings((current) => ({ ...current, storeVersion: "1.0.0" }));

    expect(mkdirSync).toHaveBeenCalledWith("/tmp/vortex-config/Vortex", { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/vortex-config/Vortex/startup.json",
      JSON.stringify({ storeVersion: "1.0.0" }),
    );
    expect(mkdirSync.mock.invocationCallOrder[0]).toBeLessThan(
      writeFileSync.mock.invocationCallOrder[0]!,
    );
  });
});
