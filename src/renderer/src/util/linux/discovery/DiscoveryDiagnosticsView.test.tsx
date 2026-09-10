import * as os from "node:os";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomRootsRegistry } from "./customRootsRegistry";
import { DiscoveryDiagnosticsView } from "./DiscoveryDiagnosticsView";
import type { IDiscoveryExecutionReport } from "./resourceDiscoveryEngine";

describe("Unified Linux Resource Discovery — DiscoveryDiagnosticsView UI Component", () => {
  const mockReport: IDiscoveryExecutionReport = {
    scannedSourcesCount: 5,
    resources: [
      {
        id: "steam:game:489830",
        kind: "game",
        provider: "steam",
        canonicalPath: "/home/user/.local/share/Steam/steamapps/common/Skyrim Special Edition",
        packagingContext: { format: "native", sandboxVisibility: "direct" },
        evidence: [
          {
            sourceType: "manifest",
            sourcePath: "/home/user/.local/share/Steam/steamapps/appmanifest_489830.vdf",
            timestamp: 12345,
          },
        ],
        confidence: "confirmed",
        validationState: { status: "valid" },
        sourceTimestamp: 12345,
      },
      {
        id: "steam:runtime:GE-Proton9",
        kind: "compatibility-runtime",
        provider: "steam",
        canonicalPath: "/home/user/.local/share/Steam/compatibilitytools.d/GE-Proton9",
        packagingContext: { format: "native", sandboxVisibility: "direct" },
        evidence: [
          {
            sourceType: "manifest",
            sourcePath: "/home/user/.local/share/Steam/compatibilitytools.d/GE-Proton9/proton",
            timestamp: 12346,
          },
        ],
        confidence: "confirmed",
        validationState: { status: "valid" },
        sourceTimestamp: 12346,
      },
    ],
    errors: [],
  };

  beforeEach(() => {
    // Mock navigator.clipboard via Object.defineProperty
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });
  });

  it("renders discovered resources and responds to search filtering", () => {
    render(<DiscoveryDiagnosticsView initialReport={mockReport} />);

    expect(screen.getByText("Linux Resource Discovery Diagnostics")).toBeDefined();
    expect(screen.getByText("steam:game:489830")).toBeDefined();
    expect(screen.getByText("steam:runtime:GE-Proton9")).toBeDefined();

    // Filter by search query "skyrim"
    const searchInput = screen.getByPlaceholderText("Search by ID, path, or provider...");
    fireEvent.change(searchInput, { target: { value: "skyrim" } });

    expect(screen.getByText("steam:game:489830")).toBeDefined();
    expect(screen.queryByText("steam:runtime:GE-Proton9")).toBeNull();
  });

  it("triggers Safe Rescan and calls onRescan callback", async () => {
    const onRescan = vi.fn().mockResolvedValue({
      scannedSourcesCount: 6,
      resources: [],
      errors: [],
    });

    render(<DiscoveryDiagnosticsView initialReport={mockReport} onRescan={onRescan} />);

    const rescanBtn = screen.getByText("Safe Rescan");
    fireEvent.click(rescanBtn);

    await waitFor(() => {
      expect(onRescan).toHaveBeenCalled();
    });
  });

  it("copies redacted report to clipboard", async () => {
    render(<DiscoveryDiagnosticsView initialReport={mockReport} />);

    const copyBtn = screen.getByText("Copy Redacted Report");
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it("allows switching tabs to manage custom roots and enforces crawl protection", () => {
    const registry = new CustomRootsRegistry();
    render(<DiscoveryDiagnosticsView initialReport={mockReport} customRootsRegistry={registry} />);

    // Switch to custom-roots tab
    const customRootsTabBtn = screen.getByText(/Approved Custom Roots/);
    fireEvent.click(customRootsTabBtn);

    expect(screen.getByText("Add User-Approved Custom Root")).toBeDefined();

    // Attempt to add root / which is prohibited
    const pathInput = screen.getByPlaceholderText("/path/to/custom/games/or/library");
    fireEvent.change(pathInput, { target: { value: "/" } });

    const addBtn = screen.getByText("Add Root");
    fireEvent.click(addBtn);

    // Expect validation error alert to appear
    expect(screen.getByText(/strictly prohibited/i)).toBeDefined();
  });
});
