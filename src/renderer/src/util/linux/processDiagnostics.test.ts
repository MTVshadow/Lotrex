import { describe, expect, it } from "vitest";

import { classifyProcessExit, formatExitCodeHex } from "./processDiagnostics";

describe("process diagnostics and exit code classification", () => {
  it("formats exit codes as 32-bit unsigned hex", () => {
    expect(formatExitCodeHex(null)).toBeUndefined();
    expect(formatExitCodeHex(0)).toBe("0x0");
    expect(formatExitCodeHex(127)).toBe("0x7F");
    expect(formatExitCodeHex(0xc0000135)).toBe("0xC0000135");
    // Signed negative 32-bit integers are correctly normalized
    expect(formatExitCodeHex(-1073741515)).toBe("0xC0000135");
    expect(formatExitCodeHex(-1073741819)).toBe("0xC0000005");
  });

  it("classifies success exit code 0", () => {
    const res = classifyProcessExit({
      executable: "/usr/bin/tool",
      processLayer: "native-tool",
      exitCode: 0,
    });
    expect(res.category).toBe("success");
    expect(res.exitCode).toBe(0);
    expect(res.diagnosticLabel).toBe("Completed Successfully");
    expect(res.remediation).toBe("");
  });

  describe("timeout classification", () => {
    it("distinguishes slow-start timeout from hung execution timeout", () => {
      const slowStartRes = classifyProcessExit({
        executable: "SkyrimSE.exe",
        processLayer: "proton-runtime",
        exitCode: null,
        timedOut: true,
        isSlowStart: true,
        timeoutMS: 60000,
      });
      expect(slowStartRes.category).toBe("timeout");
      expect(slowStartRes.diagnosticLabel).toContain("Slow Start");
      expect(slowStartRes.isSlowStart).toBe(true);
      expect(slowStartRes.remediation).toContain("VORTEX_PROTON_LAUNCH_TIMEOUT_MS");

      const hungRes = classifyProcessExit({
        executable: "SkyrimSE.exe",
        processLayer: "proton-runtime",
        exitCode: null,
        timedOut: true,
        isSlowStart: false,
        timeoutMS: 120000,
      });
      expect(hungRes.category).toBe("timeout");
      expect(hungRes.diagnosticLabel).toBe("Process Execution Timeout");
      expect(hungRes.isSlowStart).toBe(false);
      expect(hungRes.remediation).toContain("120000ms");
    });
  });

  describe("Windows / Wine NTSTATUS exit codes", () => {
    it("detects 0xC0000135 (STATUS_DLL_NOT_FOUND) as missing dependency", () => {
      const res = classifyProcessExit({
        executable: "SkyrimSE.exe",
        processLayer: "proton-runtime",
        exitCode: 0xc0000135,
      });
      expect(res.category).toBe("missing-dependency");
      expect(res.diagnosticLabel).toContain("0xC0000135");
      expect(res.remediation).toContain("redistributable");
      expect(res.userFacingMessage).toContain("SkyrimSE.exe");
    });

    it("detects 0xC0000005 (STATUS_ACCESS_VIOLATION) as access violation", () => {
      const res = classifyProcessExit({
        executable: "Fallout4.exe",
        processLayer: "proton-runtime",
        exitCode: 0xc0000005,
      });
      expect(res.category).toBe("access-violation");
      expect(res.diagnosticLabel).toContain("0xC0000005");
      expect(res.remediation).toContain("memory access");
    });

    it("detects 0xE0434352 (.NET exception)", () => {
      const res = classifyProcessExit({
        executable: "BodySlide.exe",
        processLayer: "proton-runtime",
        exitCode: 0xe0434352,
      });
      expect(res.category).toBe("dotnet-error");
      expect(res.diagnosticLabel).toContain(".NET");
      expect(res.remediation).toContain("Wine Mono");
    });

    it("detects 0xC000026B (shutdown in progress)", () => {
      const res = classifyProcessExit({
        executable: "CreationKit.exe",
        processLayer: "proton-runtime",
        exitCode: 0xc000026b,
      });
      expect(res.category).toBe("terminated-by-signal");
      expect(res.diagnosticLabel).toContain("Wine Server");
    });
  });

  describe("Linux dynamic linker and permission exit codes", () => {
    it("identifies code 127 as missing dynamic library with layer-aware messages", () => {
      const protonRes = classifyProcessExit({
        executable: "proton",
        processLayer: "proton-runtime",
        exitCode: 127,
      });
      expect(protonRes.category).toBe("missing-dependency");
      expect(protonRes.diagnosticLabel).toContain("Proton Runner");

      const nativeRes = classifyProcessExit({
        executable: "loot",
        processLayer: "native-tool",
        exitCode: 127,
      });
      expect(nativeRes.category).toBe("missing-dependency");
      expect(nativeRes.diagnosticLabel).toContain("Missing Linux");
    });

    it("identifies code 126 as non-executable / permission denied", () => {
      const res = classifyProcessExit({
        executable: "script.sh",
        processLayer: "native-tool",
        exitCode: 126,
      });
      expect(res.category).toBe("permission-denied");
      expect(res.diagnosticLabel).toContain("126");
      expect(res.remediation).toContain("chmod +x");
    });
  });

  describe("POSIX signal exits", () => {
    it("identifies SIGSEGV and code 139 as crash", () => {
      const resSignal = classifyProcessExit({
        executable: "game_binary",
        processLayer: "native-game",
        exitCode: null,
        signal: "SIGSEGV",
      });
      expect(resSignal.category).toBe("crash");
      expect(resSignal.diagnosticLabel).toContain("SIGSEGV");

      const resCode = classifyProcessExit({
        executable: "game_binary",
        processLayer: "native-game",
        exitCode: 139,
      });
      expect(resCode.category).toBe("crash");
    });

    it("identifies SIGABRT and code 134 as crash", () => {
      const res = classifyProcessExit({
        executable: "game_binary",
        processLayer: "native-game",
        exitCode: null,
        signal: "SIGABRT",
      });
      expect(res.category).toBe("crash");
      expect(res.diagnosticLabel).toContain("SIGABRT");
    });

    it("identifies SIGKILL and code 137 as forceful termination", () => {
      const res = classifyProcessExit({
        executable: "SkyrimSE.exe",
        processLayer: "proton-runtime",
        exitCode: null,
        signal: "SIGKILL",
      });
      expect(res.category).toBe("terminated-by-signal");
      expect(res.diagnosticLabel).toContain("SIGKILL");
      expect(res.remediation).toContain("OOM");
    });

    it("identifies SIGTERM and code 143 as clean termination", () => {
      const res = classifyProcessExit({
        executable: "SkyrimSE.exe",
        processLayer: "proton-runtime",
        exitCode: 143,
      });
      expect(res.category).toBe("terminated-by-signal");
      expect(res.diagnosticLabel).toContain("SIGTERM");
    });
  });

  describe("Launcher handoff and unknown exit codes", () => {
    it("classifies launcher-handoff failures", () => {
      const res = classifyProcessExit({
        executable: "steam://rungameid/489830",
        processLayer: "launcher-handoff",
        exitCode: 1,
      });
      expect(res.category).toBe("launcher-unavailable");
      expect(res.diagnosticLabel).toContain("Launcher Handoff");
      expect(res.remediation).toContain("Steam, Heroic, or Lutris");
    });

    it("handles generic unknown non-zero exit codes and appends sanitized output snippet", () => {
      const res = classifyProcessExit({
        executable: "custom_tool",
        processLayer: "native-tool",
        exitCode: 42,
        outputSnippet: "line1\nline2\nCritical assertion failed at main.cpp:45",
      });
      expect(res.category).toBe("unknown-failure");
      expect(res.diagnosticLabel).toBe("Failed with Exit Code 42");
      expect(res.userFacingMessage).toContain("Critical assertion failed at main.cpp:45");
    });
  });
});
