import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateResourceCandidate } from "./candidateValidation";

describe("Unified Linux Resource Discovery — Phase 4: Candidate Validation and Confidence", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-candidate-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  it("never trusts dangling symlinks and reports them as invalid", async () => {
    const brokenLink = path.join(tempDir, "broken_proton");
    const nonExistentTarget = path.join(tempDir, "non_existent_target");
    await fs.symlink(nonExistentTarget, brokenLink);

    const res = validateResourceCandidate(brokenLink, { requireExecutable: true });
    expect(res.validationState.status).toBe("invalid");
    expect(res.confidence).toBe("user-confirmation-required");
    expect(res.validationState.reasons?.[0]).toContain("dangling or broken symbolic link");
  });

  it("identifies valid ELF executable binaries with proper permissions", async () => {
    const elfPath = path.join(tempDir, "game_binary");
    // ELF header: 0x7F 'E' 'L' 'F'
    const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    await fs.writeFile(elfPath, elfBuffer, { mode: 0o755 });

    const res = validateResourceCandidate(elfPath, {
      requireExecutable: true,
      manifestOwned: true,
    });
    expect(res.validationState.status).toBe("valid");
    expect(res.hasExecutableIdentity).toBe(true);
    expect(res.confidence).toBe("confirmed");
  });

  it("identifies shell scripts with shebang headers", async () => {
    const scriptPath = path.join(tempDir, "proton");
    await fs.writeFile(scriptPath, "#!/usr/bin/env python3\nprint('proton')\n", { mode: 0o755 });

    const res = validateResourceCandidate(scriptPath, {
      requireExecutable: true,
      manifestOwned: true,
    });
    expect(res.validationState.status).toBe("valid");
    expect(res.hasExecutableIdentity).toBe(true);
    expect(res.confidence).toBe("confirmed");
  });

  it("identifies Windows PE binaries (MZ header) for Proton games", async () => {
    const pePath = path.join(tempDir, "SkyrimSE.exe");
    const peBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ
    await fs.writeFile(pePath, peBuffer, { mode: 0o755 });

    const res = validateResourceCandidate(pePath, {
      requireExecutable: true,
      manifestOwned: true,
    });
    expect(res.validationState.status).toBe("valid");
    expect(res.hasExecutableIdentity).toBe(true);
    expect(res.confidence).toBe("confirmed");
  });

  it("reports corrupt executable when candidate has zero bytes", async () => {
    const emptyPath = path.join(tempDir, "empty_game");
    await fs.writeFile(emptyPath, Buffer.alloc(0), { mode: 0o755 });

    const res = validateResourceCandidate(emptyPath, { requireExecutable: true });
    expect(res.validationState.status).toBe("corrupt");
    expect(res.confidence).toBe("user-confirmation-required");
  });

  it("reports permission-missing when candidate file lacks executable permissions", async () => {
    const noExecPath = path.join(tempDir, "script.sh");
    await fs.writeFile(noExecPath, "#!/bin/sh\necho test\n", { mode: 0o644 });

    const res = validateResourceCandidate(noExecPath, { requireExecutable: true });
    expect(res.validationState.status).toBe("permission-missing");
    expect(res.confidence).toBe("user-confirmation-required");
  });

  it("verifies directory structure and required subpaths for runtimes", async () => {
    const runtimeDir = path.join(tempDir, "GE-Proton8-25");
    await fs.mkdir(runtimeDir, { recursive: true });

    // Відсутній proton та version
    const missingRes = validateResourceCandidate(runtimeDir, {
      requiredSubpaths: ["proton", "version"],
    });
    expect(missingRes.directoryValid).toBe(false);
    expect(missingRes.validationState.reasons).toBeDefined();

    // Створюємо необхідні підшляхи
    await fs.writeFile(path.join(runtimeDir, "proton"), "#!/bin/sh\n", { mode: 0o755 });
    await fs.writeFile(path.join(runtimeDir, "version"), "GE-Proton8-25\n");

    const validRes = validateResourceCandidate(runtimeDir, {
      requiredSubpaths: ["proton", "version"],
      manifestOwned: true,
    });
    expect(validRes.directoryValid).toBe(true);
    expect(validRes.confidence).toBe("confirmed");
  });

  it("handles non-existent candidate gracefully", () => {
    const nonExistent = path.join(tempDir, "ghost");
    const res = validateResourceCandidate(nonExistent, { requireExecutable: true });
    expect(res.validationState.status).toBe("missing-executable");
    expect(res.confidence).toBe("user-confirmation-required");
  });
});
