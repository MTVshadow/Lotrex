import { describe, expect, it } from "vitest";

import type { IDiscoveredResource } from "./contracts";
import { CustomRootsRegistry } from "./customRootsRegistry";
import {
  buildRedactedDiscoverySummary,
  generateRedactedDiscoveryReport,
} from "./discoveryDiagnostics";
import type { IDiscoveryExecutionReport } from "./resourceDiscoveryEngine";

describe("Unified Linux Resource Discovery — Phase 9: Discovery Diagnostics and Redaction", () => {
  const sampleReport: IDiscoveryExecutionReport = {
    scannedSourcesCount: 12,
    resources: [
      {
        id: "steam:game:489830",
        kind: "game",
        provider: "steam",
        canonicalPath: "/home/johndoe/.local/share/Steam/steamapps/common/Skyrim Special Edition",
        packagingContext: {
          format: "native",
          sandboxVisibility: "direct",
        },
        evidence: [
          {
            sourceType: "manifest",
            sourcePath: "/home/johndoe/.local/share/Steam/steamapps/appmanifest_489830.vdf",
            timestamp: 1600000000,
          },
        ],
        confidence: "confirmed",
        validationState: { status: "valid" },
        sourceTimestamp: 1600000000,
      },
      {
        id: "heroic:game:secretgame",
        kind: "game",
        provider: "heroic",
        canonicalPath: "/run/media/johndoe/ExtSSD/Games/SecretGame?api_key=SECRET_TOKEN_12345",
        packagingContext: {
          format: "flatpak",
          appId: "com.heroicgameslauncher.hgl",
          sandboxVisibility: "restricted",
        },
        evidence: [
          {
            sourceType: "manifest",
            sourcePath:
              "/home/johndoe/.var/app/com.heroicgameslauncher.hgl/config/heroic/installed.json",
            timestamp: 1600000001,
          },
        ],
        confidence: "probable",
        validationState: { status: "valid" },
        sourceTimestamp: 1600000001,
        remediation: {
          code: "flatpak-sandbox-override-required",
          message: "Flatpak access restricted to /run/media/johndoe/ExtSSD/Games/SecretGame",
          command:
            "flatpak override --user --filesystem='/run/media/johndoe/ExtSSD/Games/SecretGame' 'com.heroicgameslauncher.hgl'",
        },
      },
    ],
    errors: [{ provider: "lutris", message: "Failed to open database for user johndoe" }],
  };

  it("redacts username and sensitive query parameters in discovery summary", () => {
    const summary = buildRedactedDiscoverySummary(sampleReport, {
      homeDir: "/home/johndoe",
      userName: "johndoe",
      hostPackaging: "native",
    });

    expect(summary.totalResources).toBe(2);
    expect(summary.byKind.game).toBe(2);
    expect(summary.byProvider.steam).toBe(1);
    expect(summary.byProvider.heroic).toBe(1);

    // Verify username redaction
    for (const res of summary.resources) {
      expect(res.canonicalPath).not.toContain("johndoe");
      expect(res.canonicalPath).not.toContain("SECRET_TOKEN_12345");
      for (const ev of res.evidenceSources) {
        expect(ev.sourcePath).not.toContain("johndoe");
      }
    }

    // Verify remediation redaction
    const restrictedGame = summary.resources.find((r) => r.id === "heroic:game:secretgame");
    expect(restrictedGame?.remediation?.command).not.toContain("johndoe");
    expect(restrictedGame?.remediation?.message).not.toContain("johndoe");

    // Verify error redaction
    expect(summary.errors[0].message).not.toContain("johndoe");
  });

  it("generates structured markdown diagnostic report with custom roots and breakdown", () => {
    const registry = new CustomRootsRegistry();
    const markdown = generateRedactedDiscoveryReport(sampleReport, {
      homeDir: "/home/johndoe",
      userName: "johndoe",
      hostPackaging: "flatpak",
      lastRefresh: 1700000000000,
      customRoots: [
        {
          id: "custom-root:1",
          path: "/home/johndoe/CustomGames",
          scope: "game",
          createdAt: 1700000000000,
          validated: true,
        },
      ],
    });

    expect(markdown).toContain("# Unified Linux Resource Discovery — Diagnostic Report");
    expect(markdown).toContain("## 1. Environment & Discovery Summary");
    expect(markdown).toContain("Host Packaging:");
    expect(markdown).toContain("**Total Resources Discovered:** 2");
    expect(markdown).toContain("## 2. User-Approved Custom Roots");
    expect(markdown).toContain("## 3. Discovered Resources Matrix");
    expect(markdown).toContain("[GAME] steam:game:489830");
    expect(markdown).toContain("[GAME] heroic:game:secretgame");
    expect(markdown).toContain("Duplicate Resolution & Evidence:");
    expect(markdown).toContain("flatpak-sandbox-override-required");

    // Critical privacy requirement: no raw usernames or secrets in markdown output
    expect(markdown).not.toContain("johndoe");
    expect(markdown).not.toContain("SECRET_TOKEN_12345");
  });
});
