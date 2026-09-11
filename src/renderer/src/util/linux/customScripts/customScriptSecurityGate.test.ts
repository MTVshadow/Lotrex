import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ApprovalRevokedError,
  ForbiddenHostAreaError,
  type ICustomScriptManifest,
  type IScriptApprovalRecord,
  type IScriptExecutionContext,
  PermissionBoundaryError,
  PrefixBoundaryError,
  PrivilegeEscalationForbiddenError,
  SafeModeActiveError,
  ScriptExecutionForbiddenError,
} from "./contracts";
import {
  DEFAULT_ALLOWED_ENV_VARS,
  redactScriptOutput,
  sanitizeScriptEnvironment,
} from "./environmentSanitization";
import { cleanupStaleEphemeralWorkspaces, createEphemeralWorkspace } from "./ephemeralWorkspace";
import {
  assertNoPrivilegeEscalation,
  assertPathNotForbidden,
  assertPathWithinDeclaredRoots,
  assertPrefixIsolation,
} from "./forbiddenAreas";
import {
  createScriptApproval,
  executeCustomScript,
  generateScriptPreview,
  isSafeModeActive,
  validateScriptApproval,
} from "./securityGate";

describe("CustomScriptSecurityGate (Linux Roadmap)", () => {
  let testTempDir: string;
  let gameInstallDir: string;
  let stagingDir: string;
  let profileDir: string;
  let saveDir: string;
  let prefixDir: string;

  beforeAll(async () => {
    testTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-test-custom-scripts-"));
    gameInstallDir = path.join(testTempDir, "game_install");
    stagingDir = path.join(testTempDir, "staging");
    profileDir = path.join(testTempDir, "profile");
    saveDir = path.join(testTempDir, "saves");
    prefixDir = path.join(testTempDir, "prefix_game1");

    await fs.mkdir(gameInstallDir, { recursive: true });
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.mkdir(profileDir, { recursive: true });
    await fs.mkdir(saveDir, { recursive: true });
    await fs.mkdir(prefixDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testTempDir, { recursive: true, force: true });
  });

  const makeBaseManifest = (
    overrides: Partial<ICustomScriptManifest> = {},
  ): ICustomScriptManifest => ({
    id: "test-patcher",
    name: "Test Mod Patcher",
    version: "1.0.0",
    source: { type: "mod", id: "mod_123" },
    lifecycleEvents: ["after-deploy"],
    interpreter: "/bin/bash",
    scriptContent: "echo 'Patcher executed successfully'",
    arguments: [],
    timeoutMs: 5000,
    allowedReadRoots: [stagingDir],
    allowedWriteRoots: [gameInstallDir],
    expectedOutputs: ["patch_output.txt"],
    ...overrides,
  });

  const makeBaseContext = (
    overrides: Partial<IScriptExecutionContext> = {},
  ): IScriptExecutionContext => ({
    gameId: "test_game",
    gameInstallPath: gameInstallDir,
    stagingPath: stagingDir,
    profilePath: profileDir,
    saveRoots: [saveDir],
    prefixPath: prefixDir,
    triggerSource: "user-direct",
    lifecycleEvent: "after-deploy",
    ...overrides,
  });

  // CONTROL 1: No automatic execution
  describe("Control 1: No automatic execution", () => {
    it("rejects execution when triggerSource is not user-direct (mod, collection, adapter, update)", async () => {
      const manifest = makeBaseManifest();
      const content = manifest.scriptContent!;
      const approval = createScriptApproval(manifest, content);

      const unprivilegedSources = [
        "mod",
        "collection",
        "adapter",
        "imported-profile",
        "update",
        "dependency-install",
      ] as const;

      for (const source of unprivilegedSources) {
        const context = makeBaseContext({ triggerSource: source });
        await expect(executeCustomScript(manifest, content, context, approval)).rejects.toThrow(
          ScriptExecutionForbiddenError,
        );
      }
    });

    it("rejects execution when script approval status is not 'approved'", async () => {
      const manifest = makeBaseManifest();
      const content = manifest.scriptContent!;
      const approval = createScriptApproval(manifest, content);
      approval.status = "pending_approval";

      const context = makeBaseContext({ triggerSource: "user-direct" });
      await expect(executeCustomScript(manifest, content, context, approval)).rejects.toThrow(
        ApprovalRevokedError,
      );
    });

    it("fails closed when no operating-system sandbox is available", async () => {
      const manifest = makeBaseManifest();
      const content = manifest.scriptContent!;
      const approval = createScriptApproval(manifest, content);

      await expect(
        executeCustomScript(manifest, content, makeBaseContext(), approval),
      ).rejects.toThrow("operating-system sandbox");
    });
  });

  // CONTROL 2: Minimum filesystem permissions
  describe("Control 2: Minimum filesystem permissions", () => {
    it("validates that paths must be within declared roots", () => {
      const declaredRoots = [gameInstallDir];
      const validPath = path.join(gameInstallDir, "subdir", "file.txt");
      const outsidePath = path.join(testTempDir, "other_unrelated_folder", "file.txt");

      expect(() => assertPathWithinDeclaredRoots(validPath, declaredRoots, "write")).not.toThrow();
      expect(() => assertPathWithinDeclaredRoots(outsidePath, declaredRoots, "write")).toThrow(
        PermissionBoundaryError,
      );
    });

    it("fails when an undeclared write root is accessed", () => {
      expect(() => assertPathWithinDeclaredRoots(stagingDir, [gameInstallDir], "write")).toThrow(
        PermissionBoundaryError,
      );
    });
  });

  // CONTROL 3: Forbidden host areas
  describe("Control 3: Forbidden host areas", () => {
    it("rejects root filesystem '/'", () => {
      expect(() => assertPathNotForbidden("/")).toThrow(ForbiddenHostAreaError);
    });

    it("rejects whole user home directory without subpath", () => {
      expect(() => assertPathNotForbidden(os.homedir())).toThrow(ForbiddenHostAreaError);
    });

    it("rejects system directories (/etc, /usr, /bin, /boot, /sys, /proc, /dev)", () => {
      expect(() => assertPathNotForbidden("/etc")).toThrow(ForbiddenHostAreaError);
      expect(() => assertPathNotForbidden("/usr")).toThrow(ForbiddenHostAreaError);
      expect(() => assertPathNotForbidden("/bin")).toThrow(ForbiddenHostAreaError);
      expect(() => assertPathNotForbidden("/boot")).toThrow(ForbiddenHostAreaError);
      expect(() => assertPathNotForbidden("/sys")).toThrow(ForbiddenHostAreaError);
      expect(() => assertPathNotForbidden("/proc")).toThrow(ForbiddenHostAreaError);
      expect(() => assertPathNotForbidden("/dev")).toThrow(ForbiddenHostAreaError);
    });

    it("rejects SSH and GPG configuration roots (~/.ssh, ~/.gnupg)", () => {
      expect(() => assertPathNotForbidden(path.join(os.homedir(), ".ssh"))).toThrow(
        ForbiddenHostAreaError,
      );
      expect(() => assertPathNotForbidden(path.join(os.homedir(), ".gnupg"))).toThrow(
        ForbiddenHostAreaError,
      );
    });

    it("rejects keyrings and secret storage (~/.local/share/keyrings, ~/.config/secret-service)", () => {
      expect(() =>
        assertPathNotForbidden(path.join(os.homedir(), ".local", "share", "keyrings")),
      ).toThrow(ForbiddenHostAreaError);
      expect(() =>
        assertPathNotForbidden(path.join(os.homedir(), ".config", "secret-service")),
      ).toThrow(ForbiddenHostAreaError);
    });

    it("rejects browser profiles (~/.mozilla, ~/.config/google-chrome)", () => {
      expect(() => assertPathNotForbidden(path.join(os.homedir(), ".mozilla"))).toThrow(
        ForbiddenHostAreaError,
      );
      expect(() =>
        assertPathNotForbidden(path.join(os.homedir(), ".config", "google-chrome")),
      ).toThrow(ForbiddenHostAreaError);
    });

    it("resolves symlinks and rejects symlink targets pointing to forbidden areas", async () => {
      const linkToEtc = path.join(testTempDir, "link_to_etc");
      try {
        await fs.symlink("/etc", linkToEtc);
        expect(() => assertPathNotForbidden(linkToEtc)).toThrow(ForbiddenHostAreaError);
      } finally {
        await fs.rm(linkToEtc, { force: true });
      }
    });

    it("resolves symlink targeting ~/.ssh and rejects it", async () => {
      const linkToSsh = path.join(testTempDir, "link_to_ssh");
      try {
        await fs.symlink(path.join(os.homedir(), ".ssh"), linkToSsh);
        expect(() => assertPathNotForbidden(linkToSsh)).toThrow(ForbiddenHostAreaError);
      } finally {
        await fs.rm(linkToSsh, { force: true });
      }
    });
  });

  // CONTROL 4: Exact pre-execution preview
  describe("Control 4: Exact pre-execution preview", () => {
    it("generates an exact pre-execution audit preview containing full script identity and commands", () => {
      const manifest = makeBaseManifest();
      const content = manifest.scriptContent!;
      const approval = createScriptApproval(manifest, content);
      const context = makeBaseContext();

      const preview = generateScriptPreview(manifest, context, approval, content);

      expect(preview.scriptIdentity.id).toBe("test-patcher");
      expect(preview.command.interpreter).toBe("/bin/bash");
      expect(preview.lifecycleEvent).toBe("after-deploy");
      expect(preview.filesystem.readableRoots).toEqual([stagingDir]);
      expect(preview.filesystem.writableRoots).toEqual([gameInstallDir]);
      expect(preview.timeoutMs).toBe(5000);
      expect(preview.expectedOutputs).toEqual(["patch_output.txt"]);
      expect(preview.transaction.willJournal).toBe(true);
      expect(preview.approvalStatus).toBe("approved");
      expect(preview.canExecute).toBe(true);
      expect(preview.rejectionReasons).toHaveLength(0);
    });

    it("reports rejection reasons in preview when script is unapproved or targeting forbidden paths", () => {
      const manifest = makeBaseManifest({
        allowedWriteRoots: ["/etc"],
      });
      const context = makeBaseContext();

      const preview = generateScriptPreview(manifest, context, undefined, manifest.scriptContent);
      expect(preview.canExecute).toBe(false);
      expect(preview.rejectionReasons.length).toBeGreaterThan(0);
      expect(preview.rejectionReasons.some((r) => r.includes("forbidden host boundary"))).toBe(
        true,
      );
    });
  });

  // CONTROL 5: Transactional managed-file writes
  describe("Control 5: Transactional managed-file writes", () => {
    it("atomically backs up existing managed outputs and restores them on script failure", async () => {
      const targetFile = path.join(gameInstallDir, "patch_output.txt");
      await fs.writeFile(targetFile, "ORIGINAL_VANILLA_CONTENT", "utf8");

      const failingManifest = makeBaseManifest({
        scriptContent: `
          echo "MALICIOUS_OVERWRITE" > "${targetFile}"
          exit 1
        `,
      });
      const approval = createScriptApproval(failingManifest, failingManifest.scriptContent!);
      const context = makeBaseContext();

      const result = await executeCustomScript(
        failingManifest,
        failingManifest.scriptContent!,
        context,
        approval,
        { allowUnsandboxedTestExecution: true },
      );

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);

      // Verify that the original content was restored intact
      const restored = await fs.readFile(targetFile, "utf8");
      expect(restored).toBe("ORIGINAL_VANILLA_CONTENT");
    });

    it("removes newly created files if script fails", async () => {
      const newFile = path.join(gameInstallDir, "new_created_file.txt");
      await fs.rm(newFile, { force: true });

      const failingManifest = makeBaseManifest({
        expectedOutputs: ["new_created_file.txt"],
        scriptContent: `
          echo "PARTIAL_WRITTEN_DATA" > "${newFile}"
          exit 42
        `,
      });
      const approval = createScriptApproval(failingManifest, failingManifest.scriptContent!);
      const context = makeBaseContext();

      const result = await executeCustomScript(
        failingManifest,
        failingManifest.scriptContent!,
        context,
        approval,
        { allowUnsandboxedTestExecution: true },
      );

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);

      // Verify that the newly created file was safely removed
      await expect(fs.stat(newFile)).rejects.toThrow();
    });

    it("fails safely and rolls back when an undeclared output file is created", async () => {
      const rogueFile = path.join(gameInstallDir, "rogue_undeclared_output.txt");
      await fs.rm(rogueFile, { force: true });

      const rogueManifest = makeBaseManifest({
        expectedOutputs: ["patch_output.txt"],
        scriptContent: `
          echo "VALID_DATA" > "${path.join(gameInstallDir, "patch_output.txt")}"
          echo "HOSTILE_UNDECLARED_DATA" > "${rogueFile}"
          exit 0
        `,
      });
      const approval = createScriptApproval(rogueManifest, rogueManifest.scriptContent!);
      const context = makeBaseContext();

      const result = await executeCustomScript(
        rogueManifest,
        rogueManifest.scriptContent!,
        context,
        approval,
        { allowUnsandboxedTestExecution: true },
      );

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
      expect(result.stderr).toContain("Unexpected undeclared file output created");

      // Verify that rogue file was deleted by rollback
      await expect(fs.stat(rogueFile)).rejects.toThrow();
    });
  });

  // CONTROL 6: Isolated Proton/Wine prefixes
  describe("Control 6: Isolated Proton/Wine prefixes", () => {
    it("rejects Wine dosdevices/z: escape attempts", () => {
      expect(() => assertPrefixIsolation("/dosdevices/z:/etc/passwd", prefixDir)).toThrow(
        PrefixBoundaryError,
      );
    });

    it("rejects cross-prefix writes to other game compatdata/pfx directories", () => {
      const otherPrefix = path.join(testTempDir, "other_game_prefix", "pfx", "drive_c");
      expect(() => assertPrefixIsolation(otherPrefix, prefixDir)).toThrow(PrefixBoundaryError);
    });

    it("allows paths strictly within configured prefix", () => {
      const validPrefixPath = path.join(prefixDir, "drive_c", "users", "steamuser");
      expect(() => assertPrefixIsolation(validPrefixPath, prefixDir)).not.toThrow();
    });
  });

  // CONTROL 7: Sanitized process environment & secret redaction
  describe("Control 7: Sanitized process environment & secret redaction", () => {
    it("strips sensitive environment variables (tokens, keys, passwords)", () => {
      const originalEnv = process.env;
      try {
        process.env["NEXUS_API_KEY"] = "super-secret-key-12345";
        process.env["GITHUB_TOKEN"] = "ghp_abcdef1234567890";
        process.env["DBUS_SESSION_BUS_ADDRESS"] = "unix:path=/run/user/1000/bus";
        process.env["SOME_PASSWORD"] = "secretPass99";

        const manifest = makeBaseManifest();
        const context = makeBaseContext();
        const sanitized = sanitizeScriptEnvironment(manifest, context, "/tmp/mock-workspace");

        expect(sanitized["NEXUS_API_KEY"]).toBeUndefined();
        expect(sanitized["GITHUB_TOKEN"]).toBeUndefined();
        expect(sanitized["DBUS_SESSION_BUS_ADDRESS"]).toBeUndefined();
        expect(sanitized["SOME_PASSWORD"]).toBeUndefined();
        expect(sanitized["TMPDIR"]).toBe("/tmp/mock-workspace");
        expect(sanitized["VORTEX_GAME_ID"]).toBe("test_game");
      } finally {
        process.env = originalEnv;
      }
    });

    it("redacts auth tokens and private hex secrets from script output", () => {
      const rawOutput =
        "Failed with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and secret 4f8b91a2c3d4e5f67890123456abcdef in /home/vhs/secrets";
      const scrubbed = redactScriptOutput(rawOutput);

      expect(scrubbed).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
      expect(scrubbed).not.toContain("4f8b91a2c3d4e5f67890123456abcdef");
      expect(scrubbed).toContain("Bearer [REDACTED_TOKEN]");
      expect(scrubbed).toContain("[REDACTED_SECRET]");
    });
  });

  // CONTROL 8: Timeout and process-tree termination
  describe("Control 8: Timeout and process-tree termination", () => {
    it("terminates hanging processes that exceed timeoutMs and marks operation timedOut", async () => {
      const hangingManifest = makeBaseManifest({
        timeoutMs: 800,
        scriptContent: `
          # Infinite loop simulating hung script
          while true; do
            sleep 0.1
          done
        `,
      });
      const approval = createScriptApproval(hangingManifest, hangingManifest.scriptContent!);
      const context = makeBaseContext();

      const result = await executeCustomScript(
        hangingManifest,
        hangingManifest.scriptContent!,
        context,
        approval,
        { allowUnsandboxedTestExecution: true },
      );

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.rolledBack).toBe(true);
    }, 10000);
  });

  // CONTROL 9: Approval invalidation
  describe("Control 9: Approval invalidation", () => {
    it("revokes approval when script source code is modified (contentHash mismatch)", () => {
      const manifest = makeBaseManifest();
      const originalContent = "echo 'Hello 1'";
      const approval = createScriptApproval(manifest, originalContent);

      const modifiedContent = "echo 'Hello 2 (tampered)'";
      const validation = validateScriptApproval(approval, manifest, modifiedContent);

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("hash mismatch");
    });

    it("revokes approval when manifest parameters (arguments/interpreter/roots) change", () => {
      const manifest = makeBaseManifest();
      const content = manifest.scriptContent!;
      const approval = createScriptApproval(manifest, content);

      const modifiedManifest = {
        ...manifest,
        arguments: ["--injected-arg"],
      };

      const validation = validateScriptApproval(approval, modifiedManifest, content);
      expect(validation.valid).toBe(false);
    });
  });

  // CONTROL 10: Safe mode
  describe("Control 10: Safe mode", () => {
    it("detects safe mode and blocks script execution immediately", async () => {
      const manifest = makeBaseManifest();
      const content = manifest.scriptContent!;
      const approval = createScriptApproval(manifest, content);
      const context = makeBaseContext({ safeMode: true });

      await expect(executeCustomScript(manifest, content, context, approval)).rejects.toThrow(
        SafeModeActiveError,
      );
    });

    it("respects VORTEX_SAFE_MODE environment variable", () => {
      const original = process.env.VORTEX_SAFE_MODE;
      try {
        process.env.VORTEX_SAFE_MODE = "1";
        expect(isSafeModeActive()).toBe(true);
      } finally {
        process.env.VORTEX_SAFE_MODE = original;
      }
    });
  });

  // CONTROL 11: Save backup before risky actions
  describe("Control 11: Save backup before risky actions", () => {
    it("creates atomic save backup before executing script that touches save files", async () => {
      const saveFile = path.join(saveDir, "savegame.dat");
      await fs.writeFile(saveFile, "ORIGINAL_SAVE_STATE", "utf8");

      const riskyManifest = makeBaseManifest({
        touchesSaveFiles: true,
        scriptContent: `
          echo "NEW_SAVE_DATA" > "${saveFile}"
        `,
      });
      const approval = createScriptApproval(riskyManifest, riskyManifest.scriptContent!);
      const context = makeBaseContext({ saveRoots: [saveDir] });

      const result = await executeCustomScript(
        riskyManifest,
        riskyManifest.scriptContent!,
        context,
        approval,
        { allowUnsandboxedTestExecution: true },
      );

      expect(result.success).toBe(true);

      // Verify that save backup directory was created
      const backupDir = path.join(profileDir, "save_backups");
      const backups = await fs.readdir(backupDir);
      expect(backups.length).toBeGreaterThan(0);
    });

    it("restores save backup when a risky script fails", async () => {
      const saveFile = path.join(saveDir, "critical_save.dat");
      await fs.writeFile(saveFile, "CRITICAL_BEFORE_FAIL", "utf8");

      const failingRiskyManifest = makeBaseManifest({
        touchesSaveFiles: true,
        scriptContent: `
          echo "CORRUPTED_SAVE" > "${saveFile}"
          exit 1
        `,
      });
      const approval = createScriptApproval(
        failingRiskyManifest,
        failingRiskyManifest.scriptContent!,
      );
      const context = makeBaseContext({ saveRoots: [saveDir] });

      const result = await executeCustomScript(
        failingRiskyManifest,
        failingRiskyManifest.scriptContent!,
        context,
        approval,
        { allowUnsandboxedTestExecution: true },
      );

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);

      // Verify original save was restored
      const restored = await fs.readFile(saveFile, "utf8");
      expect(restored).toBe("CRITICAL_BEFORE_FAIL");
    });
  });

  // CONTROL 12: Dry run and declared effects
  describe("Control 12: Dry run and declared effects", () => {
    it("simulates execution without modifying disk when dryRun is true", async () => {
      const targetFile = path.join(gameInstallDir, "dry_run_test.txt");
      await fs.rm(targetFile, { force: true });

      const manifest = makeBaseManifest({
        scriptContent: `echo "SHOULD_NOT_BE_WRITTEN" > "${targetFile}"`,
      });
      const approval = createScriptApproval(manifest, manifest.scriptContent!);
      const context = makeBaseContext({ dryRun: true });

      const result = await executeCustomScript(
        manifest,
        manifest.scriptContent!,
        context,
        approval,
      );

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.stdout).toContain("[DRY RUN]");

      // Target file must NOT have been written to disk
      await expect(fs.stat(targetFile)).rejects.toThrow();
    });
  });

  // CONTROL 13: No sudo password handling
  describe("Control 13: No sudo password handling", () => {
    it("rejects sudo/pkexec/doas/su in interpreter path", () => {
      expect(() => assertNoPrivilegeEscalation("sudo", ["echo", "test"])).toThrow(
        PrivilegeEscalationForbiddenError,
      );
      expect(() => assertNoPrivilegeEscalation("/usr/bin/pkexec", [])).toThrow(
        PrivilegeEscalationForbiddenError,
      );
      expect(() => assertNoPrivilegeEscalation("doas", [])).toThrow(
        PrivilegeEscalationForbiddenError,
      );
    });

    it("rejects sudo/pkexec/doas/su in command line arguments", () => {
      expect(() => assertNoPrivilegeEscalation("/bin/bash", ["sudo apt update"])).toThrow(
        PrivilegeEscalationForbiddenError,
      );
      expect(() => assertNoPrivilegeEscalation("/bin/bash", ["-c", "pkexec chmod 777 /"])).toThrow(
        PrivilegeEscalationForbiddenError,
      );
    });

    it("rejects privilege escalation inside script content", () => {
      expect(() =>
        assertNoPrivilegeEscalation("/bin/bash", [], "echo 'start'\nsudo rm -rf /\necho 'end'"),
      ).toThrow(PrivilegeEscalationForbiddenError);
    });
  });

  // Ephemeral workspace and cleanup
  describe("Ephemeral Workspace isolation and cleanup", () => {
    it("creates workspace with mode 0o700, stages script, verifies checksum, and cleans up", async () => {
      const scriptCode = "echo 'Isolated workspace test'";
      const workspace = await createEphemeralWorkspace("test-script", scriptCode);

      const stats = await fs.stat(workspace.workspacePath);
      // Mode on Unix: 0o700 is 16832 in decimal or & 0o777 === 0o700
      expect(stats.mode & 0o777).toBe(0o700);

      const fileContent = await fs.readFile(workspace.scriptFilePath, "utf8");
      expect(fileContent).toBe(scriptCode);

      await workspace.cleanup();
      await expect(fs.stat(workspace.workspacePath)).rejects.toThrow();
    });

    it("recovers and removes stale workspaces", async () => {
      const staleDir = path.join(os.tmpdir(), "vortex-customscript-stale-12345");
      await fs.mkdir(staleDir, { recursive: true });

      const cleaned = await cleanupStaleEphemeralWorkspaces();
      expect(cleaned).toBeGreaterThanOrEqual(1);
      await expect(fs.stat(staleDir)).rejects.toThrow();
    });
  });

  // End-to-end benign execution
  describe("End-to-end benign execution", () => {
    it("executes an approved script cleanly and attributes created files", async () => {
      const targetOutputFile = path.join(gameInstallDir, "patch_output.txt");
      await fs.rm(targetOutputFile, { force: true });

      const benignManifest = makeBaseManifest({
        scriptContent: `
          echo "GENERATED_PATCH_DATA" > "${targetOutputFile}"
          echo "Done patch generation"
        `,
      });
      const approval = createScriptApproval(benignManifest, benignManifest.scriptContent!);
      const context = makeBaseContext();

      const result = await executeCustomScript(
        benignManifest,
        benignManifest.scriptContent!,
        context,
        approval,
        { allowUnsandboxedTestExecution: true },
      );

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.rolledBack).toBe(false);
      expect(result.stdout).toContain("Done patch generation");
      expect(result.createdFiles).toContain(targetOutputFile);

      const written = await fs.readFile(targetOutputFile, "utf8");
      expect(written.trim()).toBe("GENERATED_PATCH_DATA");
    });
  });
});
