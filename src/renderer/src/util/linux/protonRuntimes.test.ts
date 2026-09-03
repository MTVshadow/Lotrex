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

    // Каталог є, але без бінарника proton
    const dummyDir = path.join(tmpDir, "dummy-proton");
    fs.mkdirSync(dummyDir);
    const noBinResult = validateCustomProtonPath(dummyDir);
    expect(noBinResult.valid).toBe(false);
    expect(noBinResult.error).toContain("відсутній обов'язковий скрипт 'proton'");
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

  it("discovers installed runtimes in steamapps and compatibilitytools.d", () => {
    const steamRoot = path.join(tmpDir, "mock-steam");
    const commonDir = path.join(steamRoot, "steamapps", "common");
    const compatDir = path.join(steamRoot, "compatibilitytools.d");

    // Створюємо Proton 9.0
    const proton9Dir = path.join(commonDir, "Proton 9.0");
    fs.mkdirSync(proton9Dir, { recursive: true });
    fs.writeFileSync(path.join(proton9Dir, "proton"), "#!/bin/sh");

    // Створюємо GE-Proton9-25
    const geDir = path.join(compatDir, "GE-Proton9-25");
    fs.mkdirSync(geDir, { recursive: true });
    fs.writeFileSync(path.join(geDir, "proton"), "#!/bin/sh");

    const found = discoverAvailableProtonRuntimes(steamRoot);
    expect(found.length).toBeGreaterThanOrEqual(2);

    const p9 = found.find((r) => r.name === "Proton 9.0");
    expect(p9).toBeDefined();
    expect(p9?.type).toBe("steam-selected");

    const ge = found.find((r) => r.name === "GE-Proton9-25");
    expect(ge).toBeDefined();
    expect(ge?.type).toBe("ge-proton");
  });
});
