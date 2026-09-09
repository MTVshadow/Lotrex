import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IExtensionApi } from "@/types/IExtensionContext";

import type { ILinuxProtonIssue } from "../../types";
import { DetailView } from "./LinuxProtonContent";
import type { IHealthCheckEntry } from "./types";

describe("Linux Health Check remediation", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockClear();
    window.api.clipboard = { readText: vi.fn(), writeText };
  });

  it("copies the exact command and lets the user recheck Flatpak access", () => {
    const onRefresh = vi.fn();
    const command = "flatpak override --user --filesystem='/mnt/Games' 'com.valvesoftware.Steam'";
    const issue: ILinuxProtonIssue = {
      appId: "com.valvesoftware.Steam",
      command,
      path: "/mnt/Games",
      reason: "flatpak-permission-missing",
      remediation: "Grant scoped access",
    };
    const entry: IHealthCheckEntry = {
      checkId: "check-linux-proton",
      data: issue,
      id: "flatpak-permission-missing:/mnt/Games",
      resolutionType: "configure",
      severity: "warning",
    };

    render(
      <DetailView api={{} as IExtensionApi} entry={entry} onBack={vi.fn()} onRefresh={onRefresh} />,
    );

    fireEvent.click(screen.getByTestId("linux-command-copy"));
    expect(writeText).toHaveBeenCalledWith(command);

    fireEvent.click(screen.getByTestId("linux-permission-recheck"));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
