import { describe, expect, it } from "vitest";

import { getPlatformRemediation, sanitizePlatformMessage } from "./platformRemediation";

describe("platformRemediation", () => {
  it("sanitizes Windows-specific terminology on Linux", () => {
    const input =
      "Please run as administrator and add a Windows Defender exclusion on the same drive.";
    const sanitized = sanitizePlatformMessage(input, "linux");

    expect(sanitized).not.toContain("run as administrator");
    expect(sanitized).not.toContain("Windows Defender");
    expect(sanitized).not.toContain("same drive");
    expect(sanitized).toContain("verify folder permissions");
    expect(sanitized).toContain("same filesystem partition");
  });

  it("leaves text unchanged on Windows", () => {
    const input = "Please run as administrator.";
    const sanitized = sanitizePlatformMessage(input, "win32");

    expect(sanitized).toBe(input);
  });

  it("provides Linux-specific remediation for permission errors with chown snippet", () => {
    const advice = getPlatformRemediation(
      "permission-denied",
      {
        path: "/home/user/Games/Skyrim",
      },
      "linux",
    );

    expect(advice.title).toBe("Помилка доступу до каталогу");
    expect(advice.commandSnippet).toBe('chown -R $USER:$USER "/home/user/Games/Skyrim"');
    expect(advice.remediation).toContain("Не запускайте Vortex через sudo");
  });

  it("provides Linux-specific remediation for cross-device links", () => {
    const advice = getPlatformRemediation("EXDEV", {}, "linux");

    expect(advice.title).toBe("Розбіжність розділів файлової системи");
    expect(advice.remediation).toContain("Symlink Deployment");
  });
});
