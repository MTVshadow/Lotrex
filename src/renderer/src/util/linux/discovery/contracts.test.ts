import { describe, expect, it } from "vitest";

import { validateDiscoveredResource, type IDiscoveredResource } from "./contracts";

describe("Unified Linux Resource Discovery — Phase 1: Common Result Contract", () => {
  it("validates a fully compliant discovered resource contract", () => {
    const validResource: IDiscoveredResource = {
      id: "steam:game:489830",
      kind: "game",
      provider: "steam",
      canonicalPath: "/home/user/.local/share/Steam/steamapps/common/Skyrim Special Edition",
      packagingContext: {
        format: "native",
        appId: undefined,
        sandboxVisibility: "direct",
      },
      evidence: [
        {
          sourceType: "manifest",
          sourcePath: "/home/user/.local/share/Steam/steamapps/appmanifest_489830.vdf",
          details: { appid: 489830, buildid: 123456 },
          timestamp: Date.now(),
        },
      ],
      confidence: "confirmed",
      validationState: {
        status: "valid",
        reasons: [],
      },
      sourceTimestamp: Date.now(),
      metadata: {
        displayName: "The Elder Scrolls V: Skyrim Special Edition",
        appId: "489830",
      },
    };

    expect(validateDiscoveredResource(validResource)).toBe(true);
  });

  it("rejects invalid resources missing mandatory contract fields", () => {
    expect(validateDiscoveredResource(null)).toBe(false);
    expect(validateDiscoveredResource({})).toBe(false);

    // Missing evidence array
    expect(
      validateDiscoveredResource({
        id: "steam:game:1",
        kind: "game",
        provider: "steam",
        canonicalPath: "/games/Skyrim",
        packagingContext: { format: "native" },
        confidence: "confirmed",
        validationState: { status: "valid" },
        sourceTimestamp: Date.now(),
      }),
    ).toBe(false);

    // Empty evidence array
    expect(
      validateDiscoveredResource({
        id: "steam:game:1",
        kind: "game",
        provider: "steam",
        canonicalPath: "/games/Skyrim",
        packagingContext: { format: "native" },
        evidence: [],
        confidence: "confirmed",
        validationState: { status: "valid" },
        sourceTimestamp: Date.now(),
      }),
    ).toBe(false);

    // Relative canonicalPath
    expect(
      validateDiscoveredResource({
        id: "steam:game:1",
        kind: "game",
        provider: "steam",
        canonicalPath: "relative/path/Skyrim",
        packagingContext: { format: "native" },
        evidence: [{ sourceType: "manifest", sourcePath: "/manifest", timestamp: 123 }],
        confidence: "confirmed",
        validationState: { status: "valid" },
        sourceTimestamp: Date.now(),
      }),
    ).toBe(false);
  });

  it("ensures resource identity never relies on localized strings", () => {
    const resource: IDiscoveredResource = {
      id: "heroic:game:cyberpunk2077",
      kind: "game",
      provider: "heroic",
      canonicalPath: "/home/user/Games/Heroic/Cyberpunk 2077",
      packagingContext: {
        format: "flatpak",
        appId: "com.heroicgameslauncher.hgl",
        sandboxVisibility: "restricted",
      },
      evidence: [
        {
          sourceType: "manifest",
          sourcePath:
            "/home/user/.var/app/com.heroicgameslauncher.hgl/config/heroic/gog_store/installed.json",
          timestamp: Date.now(),
        },
      ],
      confidence: "confirmed",
      validationState: {
        status: "permission-missing",
        reasons: ["Sandbox permission required to access /home/user/Games/Heroic"],
      },
      sourceTimestamp: Date.now(),
      remediation: {
        code: "flatpak-override-required",
        command:
          "flatpak override --user --filesystem='/home/user/Games/Heroic' com.heroicgameslauncher.hgl",
        message: "Grant Flatpak filesystem permission",
      },
      metadata: {
        runner: "gog",
      },
    };

    expect(resource.id).toBe("heroic:game:cyberpunk2077");
    expect(resource.kind).toBe("game");
    expect(resource.provider).toBe("heroic");
    expect(validateDiscoveredResource(resource)).toBe(true);
  });
});
