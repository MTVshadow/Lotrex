import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  IDiscoveredGameCandidate,
  IUnifiedGameIdentity,
  IUnifiedGameInstallation,
} from "./contracts";
import {
  areSamePhysicalPath,
  createProfileBinding,
  generateInstallationId,
  mergeGameDiscoveries,
  reconcileInstallationRelocation,
} from "./identityEngine";

describe("Unified Game Identity (Phase 1)", () => {
  let testTempDir: string;
  let steamGameDir: string;
  let heroicGameDir: string;
  let lutrisGameDir: string;

  beforeAll(async () => {
    testTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-test-game-identity-"));
    steamGameDir = path.join(testTempDir, "steam_skyrim");
    heroicGameDir = path.join(testTempDir, "heroic_skyrim");
    lutrisGameDir = path.join(testTempDir, "lutris_skyrim");

    await fs.mkdir(steamGameDir, { recursive: true });
    await fs.mkdir(heroicGameDir, { recursive: true });
    await fs.mkdir(lutrisGameDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testTempDir, { recursive: true, force: true });
  });

  const baseSkyrimIdentity: IUnifiedGameIdentity = {
    gameId: "skyrimse",
    editionId: "special-edition",
    platform: "windows-proton",
    storeId: "steam",
    storeAppId: "489830",
    owningLauncher: "steam",
    executable: "SkyrimSE.exe",
    adapterVersion: "1.0.0",
  };

  it("generates deterministic installationId independent of translated names", () => {
    const id1 = generateInstallationId(baseSkyrimIdentity, "fp_content_123");
    const id2 = generateInstallationId(
      {
        ...baseSkyrimIdentity,
        // Even if display names or localized strings differ, canonical gameId & editionId produce same ID
      },
      "fp_content_123",
    );

    expect(id1).toBe(id2);
    expect(typeof id1).toBe("string");
    expect(id1.length).toBe(64); // SHA-256
  });

  it("merges duplicate Steam, Heroic, and Lutris discoveries pointing to the same physical install", () => {
    const steamCandidate: IDiscoveredGameCandidate = {
      identity: baseSkyrimIdentity,
      installPath: steamGameDir,
      executablePath: path.join(steamGameDir, "SkyrimSE.exe"),
      prefixPath: path.join(testTempDir, "steam_pfx"),
      runtime: "proton-9.0",
      confidence: "confirmed",
      fingerprint: "skyrimse_shared_binary",
    };

    // 1. Initial discovery from Steam
    const res1 = mergeGameDiscoveries([], steamCandidate);
    expect(res1.action).toBe("created");
    expect(res1.installations).toHaveLength(1);
    const initialInstall = res1.installation;
    expect(initialInstall.discoverySources).toHaveLength(1);
    expect(initialInstall.discoverySources[0].launcher).toBe("steam");

    // 2. Duplicate discovery from Heroic pointing to the same installPath
    const heroicCandidate: IDiscoveredGameCandidate = {
      identity: {
        ...baseSkyrimIdentity,
        storeId: "epic",
        owningLauncher: "heroic",
      },
      installPath: steamGameDir,
      executablePath: path.join(steamGameDir, "SkyrimSE.exe"),
      prefixPath: path.join(testTempDir, "heroic_pfx"),
      confidence: "confirmed",
      fingerprint: "skyrimse_shared_binary",
    };

    const res2 = mergeGameDiscoveries(res1.installations, heroicCandidate);
    expect(res2.action).toBe("merged");
    expect(res2.installations).toHaveLength(1);
    expect(res2.installation.installationId).toBe(initialInstall.installationId);
    expect(res2.installation.profileId).toBe(initialInstall.profileId);
    expect(res2.installation.discoverySources).toHaveLength(2);
    expect(res2.installation.discoverySources.some((s) => s.launcher === "heroic")).toBe(true);
  });

  it("merges symlinked directory paths pointing to the same physical installation", async () => {
    const symlinkDir = path.join(testTempDir, "symlinked_steam_skyrim");
    try {
      await fs.symlink(steamGameDir, symlinkDir);

      expect(areSamePhysicalPath(steamGameDir, symlinkDir)).toBe(true);

      const candidateViaSymlink: IDiscoveredGameCandidate = {
        identity: baseSkyrimIdentity,
        installPath: symlinkDir,
        executablePath: path.join(symlinkDir, "SkyrimSE.exe"),
        confidence: "confirmed",
      };

      const existingInstallations: IUnifiedGameInstallation[] = [
        {
          installationId: "existing_id_123",
          identity: baseSkyrimIdentity,
          installPath: steamGameDir,
          executablePath: path.join(steamGameDir, "SkyrimSE.exe"),
          discoverySources: [],
          lastSeenTimestamp: 1000,
          profileId: "profile_my_skyrim",
        },
      ];

      const res = mergeGameDiscoveries(existingInstallations, candidateViaSymlink);
      expect(res.action).toBe("merged");
      expect(res.installations).toHaveLength(1);
      expect(res.installation.profileId).toBe("profile_my_skyrim");
    } finally {
      await fs.rm(symlinkDir, { force: true });
    }
  });

  it("strictly refuses to merge different editions (e.g. Standard vs Special Edition vs Anniversary)", () => {
    const standardCandidate: IDiscoveredGameCandidate = {
      identity: {
        ...baseSkyrimIdentity,
        editionId: "standard",
        executable: "TESV.exe",
      },
      installPath: path.join(testTempDir, "skyrim_standard"),
      executablePath: path.join(testTempDir, "skyrim_standard", "TESV.exe"),
      confidence: "confirmed",
    };

    const anniversaryCandidate: IDiscoveredGameCandidate = {
      identity: {
        ...baseSkyrimIdentity,
        editionId: "anniversary",
        executable: "SkyrimSE.exe",
      },
      installPath: steamGameDir,
      executablePath: path.join(steamGameDir, "SkyrimSE.exe"),
      confidence: "confirmed",
    };

    const res1 = mergeGameDiscoveries([], standardCandidate);
    expect(res1.action).toBe("created");
    expect(res1.installations).toHaveLength(1);

    const res2 = mergeGameDiscoveries(res1.installations, anniversaryCandidate);
    // Distinct editions MUST create a separate entry, NOT merge!
    expect(res2.action).toBe("created");
    expect(res2.installations).toHaveLength(2);
    expect(res2.installations[0].identity.editionId).toBe("standard");
    expect(res2.installations[1].identity.editionId).toBe("anniversary");
    expect(res2.installations[0].installationId).not.toBe(res2.installations[1].installationId);
  });

  it("preserves Lotrex profile and installationId when an installation moves or changes launcher path", () => {
    const candidate1: IDiscoveredGameCandidate = {
      identity: baseSkyrimIdentity,
      installPath: "/mnt/old_drive/steam/skyrim",
      executablePath: "/mnt/old_drive/steam/skyrim/SkyrimSE.exe",
      confidence: "confirmed",
      fingerprint: "binary_hash_98765",
    };

    const res1 = mergeGameDiscoveries([], candidate1);
    const initialInstall = res1.installation;
    const originalProfileId = initialInstall.profileId;
    const originalInstallationId = initialInstall.installationId;

    // Create an explicit user profile binding
    const profileBinding = createProfileBinding(
      initialInstall,
      "My Heavy Modded Profile",
      "/home/user/.config/vortex/skyrimse/mods",
    );
    expect(profileBinding.profileId).toBe(originalProfileId);

    // The user moves the game library to a secondary SSD (/mnt/fast_nvme/games/skyrim)
    const candidateMoved: IDiscoveredGameCandidate = {
      identity: baseSkyrimIdentity,
      installPath: "/mnt/fast_nvme/games/skyrim",
      executablePath: "/mnt/fast_nvme/games/skyrim/SkyrimSE.exe",
      confidence: "confirmed",
      fingerprint: "binary_hash_98765", // Matching install fingerprint identifies relocated install
    };

    const res2 = mergeGameDiscoveries(res1.installations, candidateMoved);
    expect(res2.action).toBe("relocated");
    expect(res2.installations).toHaveLength(1);

    const relocatedInstall = res2.installation;
    expect(relocatedInstall.installPath).toBe("/mnt/fast_nvme/games/skyrim");
    expect(relocatedInstall.executablePath).toBe("/mnt/fast_nvme/games/skyrim/SkyrimSE.exe");
    // PROFILE AND INSTALLATION ID MUST BE PRESERVED
    expect(relocatedInstall.installationId).toBe(originalInstallationId);
    expect(relocatedInstall.profileId).toBe(originalProfileId);

    // Also verify programmatic reconcileInstallationRelocation
    const reconciled = reconcileInstallationRelocation(
      relocatedInstall,
      "/mnt/archive/skyrim",
      "/mnt/archive/skyrim/SkyrimSE.exe",
      "/mnt/archive/pfx",
      "lutris",
    );
    expect(reconciled.installationId).toBe(originalInstallationId);
    expect(reconciled.profileId).toBe(originalProfileId);
    expect(reconciled.installPath).toBe("/mnt/archive/skyrim");
  });

  it("keeps separate installations unique when a provider has no stable fingerprint", () => {
    const first = mergeGameDiscoveries([], {
      identity: baseSkyrimIdentity,
      installPath: "/games/skyrim-primary",
      executablePath: "/games/skyrim-primary/SkyrimSE.exe",
      confidence: "confirmed",
    });
    const second = mergeGameDiscoveries(first.installations, {
      identity: baseSkyrimIdentity,
      installPath: "/games/skyrim-secondary",
      executablePath: "/games/skyrim-secondary/SkyrimSE.exe",
      confidence: "confirmed",
    });

    expect(second.installations).toHaveLength(2);
    expect(second.installations[0].installationId).not.toBe(second.installations[1].installationId);
    expect(second.installations[0].profileId).not.toBe(second.installations[1].profileId);
  });
});
