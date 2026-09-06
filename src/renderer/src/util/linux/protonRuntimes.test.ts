import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverAvailableProtonRuntimes, validateCustomProtonPath } from "./protonRuntimes";

describe("protonRuntimes", () => {
  const tmpDir = path.join(os.tmpdir(), "vortex-test-proton-runtimes-" + Date.now());

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it("validates missing or invalid custom proton path", () => {
    expect(validateCustomProtonPath("").valid).toBe(false);
    expect(validateCustomProtonPath("/non/existent/path").valid).toBe(false);

    // The directory exists but does not contain a Proton entry point.
    const dummyDir = path.join(tmpDir, "dummy-proton");
    fs.mkdirSync(dummyDir);
    const noBinResult = validateCustomProtonPath(dummyDir);
    expect(noBinResult.valid).toBe(false);
    expect(noBinResult.error).toContain("required 'proton' script");
  });

  it("validates correct custom proton path with executable script", () => {
    const validDir = path.join(tmpDir, "valid-proton");
    fs.mkdirSync(validDir);
    const protonBin = path.join(validDir, "proton");
    fs.writeFileSync(protonBin, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(protonBin, 0o755);

    const result = validateCustomProtonPath(validDir);
    expect(result.valid).toBe(true);
  });

  it.runIf(process.platform !== "win32")(
    "requires approval and rejects untrusted, foreign-owned, or writable runtimes",
    () => {
      const runtimeDir = path.join(tmpDir, "trusted-proton");
      const protonBin = path.join(runtimeDir, "proton");
      fs.mkdirSync(runtimeDir);
      fs.writeFileSync(protonBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      expect(validateCustomProtonPath(runtimeDir, { requireApproval: true })).toMatchObject({
        valid: false,
        error: expect.stringContaining("selected again"),
      });
      expect(
        validateCustomProtonPath(runtimeDir, {
          approvedPath: runtimeDir,
          requireApproval: true,
          untrustedRoots: [tmpDir],
        }),
      ).toMatchObject({ valid: false, error: expect.stringContaining("staging content") });
      expect(
        validateCustomProtonPath(runtimeDir, {
          approvedPath: runtimeDir,
          currentUid: (process.getuid?.() ?? 0) + 1,
          requireApproval: true,
        }),
      ).toMatchObject({ valid: false, error: expect.stringContaining("current user") });

      fs.chmodSync(runtimeDir, 0o775);
      expect(
        validateCustomProtonPath(runtimeDir, {
          approvedPath: runtimeDir,
          requireApproval: true,
        }),
      ).toMatchObject({ valid: false, error: expect.stringContaining("group or other") });
    },
  );

  it("discovers installed runtimes in steamapps and compatibilitytools.d", () => {
    const steamRoot = path.join(tmpDir, "mock-steam");
    const commonDir = path.join(steamRoot, "steamapps", "common");
    const compatDir = path.join(steamRoot, "compatibilitytools.d");

    // Create Proton 9.0.
    const proton9Dir = path.join(commonDir, "Proton 9.0");
    fs.mkdirSync(proton9Dir, { recursive: true });
    fs.writeFileSync(path.join(proton9Dir, "proton"), "#!/bin/sh");
    fs.chmodSync(path.join(proton9Dir, "proton"), 0o755);

    // Create GE-Proton9-25.
    const geDir = path.join(compatDir, "GE-Proton9-25");
    fs.mkdirSync(geDir, { recursive: true });
    fs.writeFileSync(path.join(geDir, "proton"), "#!/bin/sh");
    fs.chmodSync(path.join(geDir, "proton"), 0o755);

    const found = discoverAvailableProtonRuntimes(steamRoot);
    expect(found.length).toBeGreaterThanOrEqual(2);

    const p9 = found.find((r) => r.name === "Proton 9.0");
    expect(p9).toBeDefined();
    expect(p9?.type).toBe("steam-selected");

    const ge = found.find((r) => r.name === "GE-Proton9-25");
    expect(ge).toBeDefined();
    expect(ge?.type).toBe("ge-proton");
    expect(ge?.isUsable).toBe(true);
  });

  it("reports a discovered runtime without execute permission as unusable", () => {
    const steamRoot = path.join(tmpDir, "mock-unusable-steam");
    const runtimeDir = path.join(steamRoot, "steamapps", "common", "Proton Broken");
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "proton"), "#!/bin/sh", { mode: 0o644 });

    expect(discoverAvailableProtonRuntimes(steamRoot)).toContainEqual(
      expect.objectContaining({ isUsable: false, name: "Proton Broken" }),
    );
  });
});
