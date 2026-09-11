import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import type { IToolLaunchRequest } from "./contracts";
import { ToolOrchestrator } from "./toolOrchestrator";

/**
 * Mock child process for testing execution, logging, timeouts, and cancellation.
 */
class MockChildProcess extends EventEmitter {
  public pid = 12345;
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();

  public emitOutput(data: string) {
    this.stdout.emit("data", Buffer.from(data));
  }

  public emitError(data: string) {
    this.stderr.emit("data", Buffer.from(data));
  }

  public complete(code: number | null, signal: string | null = null) {
    this.emit("close", code, signal);
  }
}

describe("Runtime and Tool Orchestration (Phase 6)", () => {
  const orchestrator = new ToolOrchestrator();

  describe("Trusted Launch-Plan Generation for Reference Tools", () => {
    it("generates structured launch plan for SKSE under Proton using game prefix", () => {
      const request: IToolLaunchRequest = {
        toolId: "skse64",
        toolName: "SKSE64 Loader",
        executablePath: "/games/SkyrimSE/skse64_loader.exe",
        commandLine: ["-launch", "-forcesteamloader"],
        gameId: "skyrimse",
        gameInstallPath: "/games/SkyrimSE",
        defaultRuntime: "/home/user/.steam/root/compatibilitytools.d/GE-Proton9-11",
        defaultPrefixPath: "/games/SkyrimSE/pfx",
      };

      const plan = orchestrator.buildToolLaunchPlan(request);

      expect(plan.toolId).toBe("skse64");
      expect(plan.isProtonOrWine).toBe(true);
      expect(plan.executable).toBe(
        "/home/user/.steam/root/compatibilitytools.d/GE-Proton9-11/proton",
      );
      expect(plan.arguments).toEqual([
        "run",
        "/games/SkyrimSE/skse64_loader.exe",
        "-launch",
        "-forcesteamloader",
      ]);
      expect(plan.environment.WINEPREFIX).toBe("/games/SkyrimSE/pfx");
      expect(plan.environment.STEAM_COMPAT_DATA_PATH).toBe("/games/SkyrimSE/pfx");
      expect(plan.workingDirectory).toBe("/games/SkyrimSE");
      expect(plan.explanation).toContain("Shell concatenation strictly omitted");
    });

    it("generates launch plan for LOOT as a native Linux binary without Proton", () => {
      const request: IToolLaunchRequest = {
        toolId: "loot",
        toolName: "Load Order Optimisation Tool",
        executablePath: "/usr/bin/loot",
        commandLine: ["--game=SkyrimSE", "--auto-sort"],
        gameId: "skyrimse",
        gameInstallPath: "/games/SkyrimSE",
      };

      const plan = orchestrator.buildToolLaunchPlan(request);

      expect(plan.toolId).toBe("loot");
      expect(plan.isProtonOrWine).toBe(false);
      expect(plan.executable).toBe("/usr/bin/loot");
      expect(plan.arguments).toEqual(["--game=SkyrimSE", "--auto-sort"]);
      expect(plan.environment.WINEPREFIX).toBeUndefined();
    });

    it("generates launch plan for xEdit with Wine runtime and custom DLL overrides", () => {
      const request: IToolLaunchRequest = {
        toolId: "xedit",
        toolName: "SSEEdit",
        executablePath: "/tools/xedit/SSEEdit.exe",
        commandLine: ["-quickautoclean", "-IKnowWhatImDoing"],
        gameId: "skyrimse",
        gameInstallPath: "/games/SkyrimSE",
        runtimeOverride: "wine-staging",
        prefixOverride: "/home/user/.wine_xedit_pfx",
        dllOverrides: { dinput8: "n,b", dxgi: "b" },
      };

      const plan = orchestrator.buildToolLaunchPlan(request);

      expect(plan.toolId).toBe("xedit");
      expect(plan.executable).toBe("wine");
      expect(plan.arguments).toEqual([
        "/tools/xedit/SSEEdit.exe",
        "-quickautoclean",
        "-IKnowWhatImDoing",
      ]);
      expect(plan.environment.WINEPREFIX).toBe("/home/user/.wine_xedit_pfx");
      expect(plan.environment.WINEDLLOVERRIDES).toBe("dinput8=n,b;dxgi=b");
    });

    it("generates launch plan for BodySlide and Nemesis/Pandora with discrete arguments", () => {
      const requestBodySlide: IToolLaunchRequest = {
        toolId: "bodyslide",
        toolName: "BodySlide and Outfit Studio",
        executablePath: "/games/SkyrimSE/Data/CalienteTools/BodySlide/BodySlide x64.exe",
        commandLine: ["-batch", "CBBE Curvy"],
        gameId: "skyrimse",
        gameInstallPath: "/games/SkyrimSE",
        defaultRuntime: "Proton 9.0",
        defaultPrefixPath: "/games/SkyrimSE/pfx",
      };

      const planBS = orchestrator.buildToolLaunchPlan(requestBodySlide);

      // Verify whitespace preservation without shell concatenation
      expect(planBS.arguments).toEqual([
        "run",
        "/games/SkyrimSE/Data/CalienteTools/BodySlide/BodySlide x64.exe",
        "-batch",
        "CBBE Curvy",
      ]);
      expect(planBS.environment.WINEPREFIX).toBe("/games/SkyrimSE/pfx");
    });
  });

  describe("Safety and Non-Concatenation Rules", () => {
    it("rejects command line arguments with null bytes or shell injection sequences", () => {
      const requestWithNullByte: IToolLaunchRequest = {
        toolId: "bad-tool",
        toolName: "Bad Tool",
        executablePath: "/bin/tool",
        commandLine: ["normal-arg\0extra-payload"],
        gameId: "test",
        gameInstallPath: "/test",
      };

      expect(() => orchestrator.buildToolLaunchPlan(requestWithNullByte)).toThrow(
        "contains forbidden control characters",
      );

      const requestWithNewline: IToolLaunchRequest = {
        toolId: "bad-tool",
        toolName: "Bad Tool",
        executablePath: "/bin/tool",
        commandLine: ["arg1\nrm -rf /"],
        gameId: "test",
        gameInstallPath: "/test",
      };

      expect(() => orchestrator.buildToolLaunchPlan(requestWithNewline)).toThrow(
        "contains forbidden control characters",
      );
    });

    it("previews launch plans and detects configuration warnings", () => {
      const requestWithoutPrefix: IToolLaunchRequest = {
        toolId: "tool-no-pfx",
        toolName: "Windows Tool Without Prefix",
        executablePath: "/path/tool.exe",
        gameId: "test",
        gameInstallPath: "/games/test",
      };

      const preview = orchestrator.previewToolLaunchPlan(requestWithoutPrefix);
      expect(preview.warnings.length).toBeGreaterThan(0);
      expect(preview.warnings[0]).toContain("has no prefix configured");
      expect(preview.plan.isDryRunSafe).toBe(true);
    });
  });

  describe("Execution, Cancellation, Timeouts, and Exit Diagnostics", () => {
    it("handles successful execution and captures output", async () => {
      let mockChild: MockChildProcess;
      const spawnMock = vi.fn().mockImplementation(() => {
        mockChild = new MockChildProcess();
        setTimeout(() => {
          mockChild.emitOutput("LOOT masterlist updated successfully.\nSorted 120 plugins.\n");
          mockChild.complete(0);
        }, 10);
        return mockChild as any;
      });

      const plan = orchestrator.buildToolLaunchPlan({
        toolId: "loot",
        toolName: "LOOT",
        executablePath: "/usr/bin/loot",
        gameId: "skyrimse",
        gameInstallPath: "/games/SkyrimSE",
      });

      const handle = orchestrator.launchTool(plan, { spawnFn: spawnMock });
      expect(handle.pid).toBe(12345);

      const result = await handle.wait();
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Sorted 120 plugins.");
      expect(result.diagnostic.category).toBe("success");
    });

    it("handles user cancellation via process group termination", async () => {
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as any);

      let mockChild: MockChildProcess;
      const spawnMock = vi.fn().mockImplementation(() => {
        mockChild = new MockChildProcess();
        return mockChild as any;
      });

      const plan = orchestrator.buildToolLaunchPlan({
        toolId: "bodyslide",
        toolName: "BodySlide",
        executablePath: "/games/SkyrimSE/BodySlide.exe",
        gameId: "skyrimse",
        gameInstallPath: "/games/SkyrimSE",
        defaultPrefixPath: "/games/SkyrimSE/pfx",
      });

      const handle = orchestrator.launchTool(plan, { spawnFn: spawnMock });

      // Trigger cancellation
      setTimeout(async () => {
        await handle.cancel("User aborted batch build");
        mockChild.complete(null, "SIGTERM");
      }, 10);

      const result = await handle.wait();
      expect(result.cancelled).toBe(true);
      expect(result.success).toBe(false);
      expect(result.failureExplanation).toContain("cancelled by user request");
      expect(killSpy).toHaveBeenCalledWith(-12345, "SIGTERM");

      killSpy.mockRestore();
    });

    it("classifies Windows NTSTATUS failure (0xC0000135 DLL missing)", async () => {
      let mockChild: MockChildProcess;
      const spawnMock = vi.fn().mockImplementation(() => {
        mockChild = new MockChildProcess();
        setTimeout(() => {
          mockChild.emitError("err:module:import_dll Library VCRUN140.dll not found\n");
          // NTSTATUS STATUS_DLL_NOT_FOUND signed representation: -1073741515 (0xC0000135)
          mockChild.complete(-1073741515);
        }, 10);
        return mockChild as any;
      });

      const plan = orchestrator.buildToolLaunchPlan({
        toolId: "xedit",
        toolName: "SSEEdit",
        executablePath: "/tools/xedit/SSEEdit.exe",
        gameId: "skyrimse",
        gameInstallPath: "/games/SkyrimSE",
        defaultPrefixPath: "/games/SkyrimSE/pfx",
      });

      const handle = orchestrator.launchTool(plan, { spawnFn: spawnMock });
      const result = await handle.wait();

      expect(result.success).toBe(false);
      expect(result.diagnostic.category).toBe("missing-dependency");
      expect(result.diagnostic.diagnosticLabel).toContain("Missing Required Windows DLL");
      expect(result.diagnostic.remediation).toContain("Verify that required runtimes");
    });
  });
});
