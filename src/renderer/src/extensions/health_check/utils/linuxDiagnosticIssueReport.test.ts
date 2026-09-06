import { describe, expect, it } from "vitest";

import { generateLinuxIssueReport } from "./linuxDiagnosticIssueReport";

describe("Linux Health Check diagnostic report", () => {
  it("builds the exact exportable report and redacts user paths and secrets", () => {
    const report = generateLinuxIssueReport(
      {
        executablePath: "/home/private-user/Games/Skyrim/SkyrimSE.exe",
        gameName: "Skyrim Special Edition",
        message: "Failed with token=very-secret-token",
        prefixPath: "/home/private-user/.steam/compatdata/489830/pfx",
        reason: "prefix-not-found",
        severity: "error",
        steamPath: "/home/private-user/.steam/root",
      },
      "warning",
    );

    expect(report).toContain("Skyrim Special Edition");
    expect(report).toContain("prefix-not-found");
    expect(report).toContain("token=[REDACTED]");
    expect(report).not.toContain("very-secret-token");
    expect(report).not.toContain("/home/private-user");
  });
});
