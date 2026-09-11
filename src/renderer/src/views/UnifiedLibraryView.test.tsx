import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import type { IUnifiedLibraryItem } from "../util/linux/unifiedLibrary/contracts";
import { UnifiedLibraryService } from "../util/linux/unifiedLibrary/unifiedLibraryService";
import { UnifiedLibraryView } from "./UnifiedLibraryView";

describe("UnifiedLibraryView Component (Phase 4)", () => {
  const createMockItem = (
    id: string,
    gameId: string,
    editionId: string,
    displayName: string,
    canLaunch: boolean,
    canAcceptMods: boolean,
    isDuplicate = false,
    category: any = "none",
  ): IUnifiedLibraryItem => ({
    id,
    gameId,
    editionId,
    displayName,
    primaryInstallation: {
      installationId: id,
      identity: {
        gameId,
        editionId,
        platform: "windows-proton",
        storeId: "steam",
        owningLauncher: "steam",
        executable: "game.exe",
        adapterVersion: "1.0.0",
      },
      installPath: `/games/${gameId}`,
      executablePath: `/games/${gameId}/game.exe`,
      prefixPath: `/games/${gameId}/pfx`,
      runtime: "Proton 9.0",
      discoverySources: [
        {
          launcher: "steam",
          storeId: "steam",
          installPath: `/games/${gameId}`,
          confidence: "confirmed",
          discoveredAt: 1,
        },
      ],
      lastSeenTimestamp: 1,
      profileId: `profile_${id}`,
    },
    installations: [],
    origins: [
      {
        launcher: "steam",
        storeId: "steam",
        installPath: `/games/${gameId}`,
        confidence: "confirmed",
        discoveredAt: 1,
      },
    ],
    installState: canLaunch ? "installed" : "missing-files",
    runtime: {
      platform: "windows-proton",
      runtimeName: "Proton 9.0",
      isCustomOverride: false,
    },
    compatibilityStatus: {
      status: canLaunch ? "ready" : "missing-executable",
      message: canLaunch ? "Ready" : "Executable missing",
      remedies: [],
    },
    activeModProfile: {
      profileId: `profile_${id}`,
      profileName: "Default Profile",
      isActive: true,
      stagingPath: `/games/${gameId}/_staging`,
      activeModCount: 5,
      deploymentMethod: "hardlink",
      isEnabled: canAcceptMods,
    },
    adapterSupport: {
      supportLevel: canAcceptMods ? "supported" : "unsupported",
      adapterId: canAcceptMods ? "test-adapter" : undefined,
      adapterName: canAcceptMods ? "Test Game Adapter" : undefined,
      supportedCapabilities: canAcceptMods ? ["mod-types", "deployment-targets", "launch"] : [],
      unsupportedCapabilities: canAcceptMods
        ? []
        : [{ kind: "mod-types", reason: "Encrypted game archives." }],
      canAcceptMods,
      modRejectionReason: canAcceptMods
        ? undefined
        : "No compatible adapter active or mod-types unsupported.",
    },
    launchAvailability: {
      canLaunch,
      blockingReasons: canLaunch ? [] : ["Primary executable does not exist at /games/game.exe."],
      launchExplanation: canLaunch ? "Launch ready." : "Launch blocked: executable missing.",
    },
    duplicateSummary: {
      category,
      isDuplicate,
      duplicateGroupKey: "key",
      duplicateIndex: 1,
      totalInGroup: isDuplicate ? 2 : 1,
      otherLocations: isDuplicate ? ["/other/path (heroic)"] : [],
      explanation: isDuplicate ? "Duplicate installation on secondary disk." : "Unique install.",
    },
    manualCorrection: null,
    executablePath: `/games/${gameId}/game.exe`,
    installPath: `/games/${gameId}`,
    prefixPath: `/games/${gameId}/pfx`,
  });

  it("renders library items with correct badges and statuses", () => {
    const itemReady = createMockItem(
      "item-1",
      "skyrimse",
      "special-edition",
      "Skyrim Special Edition",
      true,
      true,
    );
    const itemBlocked = createMockItem(
      "item-2",
      "fallout4",
      "standard",
      "Fallout 4",
      false,
      false,
      true,
      "multi-install",
    );

    render(<UnifiedLibraryView items={[itemReady, itemBlocked]} />);

    expect(screen.getByText("Skyrim Special Edition")).toBeInTheDocument();
    expect(screen.getByText("Fallout 4")).toBeInTheDocument();

    // Edition badges
    expect(screen.getByTestId("edition-badge-item-1")).toHaveTextContent("special-edition");
    expect(screen.getByTestId("edition-badge-item-2")).toHaveTextContent("standard");

    // Launch status
    expect(screen.getByTestId("launch-status-item-1")).toHaveTextContent("Launch Ready");
    expect(screen.getByTestId("launch-status-item-2")).toHaveTextContent("Launch Blocked");

    // Mod support status
    expect(screen.getByTestId("adapter-support-item-1")).toHaveTextContent("SUPPORTED");
    expect(screen.getByTestId("adapter-support-item-2")).toHaveTextContent("UNSUPPORTED");

    // Duplicate badge on second item
    expect(screen.getByTestId("duplicate-badge-item-2")).toHaveTextContent("Duplicate (1/2)");
  });

  it("filters items dynamically by search query", async () => {
    const item1 = createMockItem(
      "1",
      "skyrimse",
      "special-edition",
      "Skyrim Special Edition",
      true,
      true,
    );
    const item2 = createMockItem("2", "witcher3", "goty", "The Witcher 3 GOTY", true, true);

    render(<UnifiedLibraryView items={[item1, item2]} />);

    expect(screen.getByText("Skyrim Special Edition")).toBeInTheDocument();
    expect(screen.getByText("The Witcher 3 GOTY")).toBeInTheDocument();

    const searchInput = screen.getByTestId("library-search-input");
    await userEvent.type(searchInput, "Witcher");

    expect(screen.queryByText("Skyrim Special Edition")).not.toBeInTheDocument();
    expect(screen.getByText("The Witcher 3 GOTY")).toBeInTheDocument();
  });

  it("filters items by duplicate filter", async () => {
    const itemUnique = createMockItem(
      "1",
      "skyrimse",
      "se",
      "Skyrim SE",
      true,
      true,
      false,
      "none",
    );
    const itemDupe = createMockItem(
      "2",
      "skyrimse",
      "se",
      "Skyrim SE Duplicate",
      true,
      true,
      true,
      "multi-install",
    );

    render(<UnifiedLibraryView items={[itemUnique, itemDupe]} />);

    const dupeSelect = screen.getByTestId("library-duplicate-filter");
    await userEvent.selectOptions(dupeSelect, "duplicates-only");

    expect(screen.queryByText("Skyrim SE")).not.toBeInTheDocument();
    expect(screen.getByText("Skyrim SE Duplicate")).toBeInTheDocument();
  });

  it("triggers onLaunch callback when launch button is clicked on a launchable item", async () => {
    const onLaunch = vi.fn();
    const item = createMockItem("1", "skyrimse", "se", "Skyrim SE", true, true);

    render(<UnifiedLibraryView items={[item]} onLaunch={onLaunch} />);

    const launchBtn = screen.getByTestId("launch-button-1");
    expect(launchBtn).not.toBeDisabled();
    await userEvent.click(launchBtn);

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith(item);
  });

  it("disables launch button and prevents click when launch is blocked", () => {
    const onLaunch = vi.fn();
    const item = createMockItem("1", "skyrimse", "se", "Skyrim SE", false, true);

    render(<UnifiedLibraryView items={[item]} onLaunch={onLaunch} />);

    const launchBtn = screen.getByTestId("launch-button-1");
    expect(launchBtn).toBeDisabled();
  });

  it("opens diagnostics modal and displays explainable reasons why launch and mods are blocked", async () => {
    const item = createMockItem("1", "skyrimse", "se", "Skyrim SE", false, false);

    render(<UnifiedLibraryView items={[item]} />);

    const diagBtn = screen.getByTestId("diagnostics-button-1");
    await userEvent.click(diagBtn);

    expect(screen.getByTestId("diagnostics-modal")).toBeInTheDocument();
    expect(screen.getByTestId("diagnostic-launch-explanation")).toHaveTextContent(
      "Launch blocked: executable missing.",
    );
    expect(screen.getByTestId("diagnostic-mod-explanation")).toHaveTextContent(
      "No compatible adapter active or mod-types unsupported.",
    );

    // Close modal
    await userEvent.click(screen.getByTestId("btn-close-diagnostics"));
    expect(screen.queryByTestId("diagnostics-modal")).not.toBeInTheDocument();
  });

  it("opens manual correction modal, allows entering overrides, and calls onApplyCorrection", async () => {
    const onApplyCorrection = vi.fn();
    const onRevertCorrection = vi.fn();
    const item = createMockItem("1", "skyrimse", "se", "Skyrim SE", true, true);

    render(
      <UnifiedLibraryView
        items={[item]}
        onApplyCorrection={onApplyCorrection}
        onRevertCorrection={onRevertCorrection}
      />,
    );

    // Open correction modal
    await userEvent.click(screen.getByTestId("manual-correction-button-1"));
    expect(screen.getByTestId("manual-correction-modal")).toBeInTheDocument();

    // Enter overrides
    const execInput = screen.getByTestId("input-override-executable");
    await userEvent.type(execInput, "/custom/path/skse64.exe");

    const prefixInput = screen.getByTestId("input-override-prefix");
    await userEvent.type(prefixInput, "/custom/prefix");

    const argsInput = screen.getByTestId("input-override-args");
    await userEvent.type(argsInput, "-novid -windowed");

    const reasonInput = screen.getByTestId("input-override-reason");
    await userEvent.type(reasonInput, "Custom SKSE wrapper");

    // Save
    await userEvent.click(screen.getByTestId("btn-save-correction"));

    expect(onApplyCorrection).toHaveBeenCalledTimes(1);
    expect(onApplyCorrection).toHaveBeenCalledWith(
      "1",
      {
        executablePath: "/custom/path/skse64.exe",
        prefixPath: "/custom/prefix",
        customLaunchArgs: ["-novid", "-windowed"],
      },
      "Custom SKSE wrapper",
    );
  });

  it("calls onRevertCorrection when revert button is clicked in correction modal", async () => {
    const onRevertCorrection = vi.fn();
    const item = createMockItem("1", "skyrimse", "se", "Skyrim SE", true, true);

    render(<UnifiedLibraryView items={[item]} onRevertCorrection={onRevertCorrection} />);

    await userEvent.click(screen.getByTestId("manual-correction-button-1"));
    await userEvent.click(screen.getByTestId("btn-revert-correction"));

    expect(onRevertCorrection).toHaveBeenCalledTimes(1);
    expect(onRevertCorrection).toHaveBeenCalledWith("1");
    expect(screen.queryByTestId("manual-correction-modal")).not.toBeInTheDocument();
  });
});
