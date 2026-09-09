export type ProcessLayer =
  | "proton-runtime"
  | "native-game"
  | "native-tool"
  | "launcher-handoff"
  | "helper";

export type ProcessDiagnosticCategory =
  | "success"
  | "timeout"
  | "missing-dependency"
  | "access-violation"
  | "dotnet-error"
  | "crash"
  | "terminated-by-signal"
  | "permission-denied"
  | "launcher-unavailable"
  | "unknown-failure";

export interface IClassifyProcessExitInput {
  executable: string;
  processLayer: ProcessLayer;
  exitCode: number | null;
  signal?: string | null;
  timedOut?: boolean;
  isSlowStart?: boolean;
  timeoutMS?: number;
  outputSnippet?: string;
}

export interface IProcessExitDiagnostic {
  category: ProcessDiagnosticCategory;
  processLayer: ProcessLayer;
  executable: string;
  exitCode: number | null;
  signal?: string | null;
  exitCodeHex?: string;
  diagnosticLabel: string;
  remediation: string;
  isSlowStart?: boolean;
  userFacingMessage: string;
}

/**
 * Common NTSTATUS / Win32 error codes surfaced by Wine and Proton:
 * - 0xC0000135 (STATUS_DLL_NOT_FOUND): DLL or redistributable missing
 * - 0xC0000005 (STATUS_ACCESS_VIOLATION): Invalid memory read/write
 * - 0xC000026B (STATUS_SHUTDOWN_IN_PROGRESS): Session or wineserver exiting
 * - 0xE0434352 (CLR Exception): Unhandled .NET exception
 */
const STATUS_DLL_NOT_FOUND_HEX = "c0000135";
const STATUS_ACCESS_VIOLATION_HEX = "c0000005";
const STATUS_SHUTDOWN_IN_PROGRESS_HEX = "c000026b";
const STATUS_DOTNET_EXCEPTION_HEX = "e0434352";

/**
 * Normalizes an integer exit code to an unsigned 32-bit hexadecimal string (e.g. 0xC0000135).
 * Windows NTSTATUS codes are 32-bit unsigned but Node.js may surface them as signed integers.
 */
export function formatExitCodeHex(code: number | null): string | undefined {
  if (code === null || !Number.isSafeInteger(code)) {
    return undefined;
  }
  return "0x" + (code >>> 0).toString(16).toUpperCase();
}

/**
 * Classifies process exit states, extracting structured diagnostics and remediation recommendations.
 * Distinguishes between Proton compatibility layer errors, native dynamic library failures,
 * permissions issues, and signal terminations.
 */
export function classifyProcessExit(input: IClassifyProcessExitInput): IProcessExitDiagnostic {
  const {
    executable,
    processLayer,
    exitCode,
    signal,
    timedOut,
    isSlowStart,
    timeoutMS,
    outputSnippet,
  } = input;
  const exitCodeHex = formatExitCodeHex(exitCode);
  const rawHex = exitCode !== null ? (exitCode >>> 0).toString(16).toLowerCase() : "";

  // 1. Timeout handling (Hung runtime vs Slow-start during prefix initialization)
  if (timedOut) {
    const diagnosticLabel = isSlowStart
      ? "Proton Initialization Timeout (Slow Start)"
      : "Process Execution Timeout";
    const remediation = isSlowStart
      ? "The Proton runtime took too long during startup (prefix update, DirectX/Vulkan shader precompilation). Consider extending VORTEX_PROTON_LAUNCH_TIMEOUT_MS or checking prefix integrity."
      : `The process stopped responding and exceeded the configured runtime limit of ${timeoutMS ?? "unknown"}ms.`;

    const userFacingMessage = `Failed to run ${processLayer} "${executable}": ${diagnosticLabel}. ${remediation}`;
    return {
      category: "timeout",
      processLayer,
      executable,
      exitCode: null,
      signal: signal ?? null,
      exitCodeHex,
      diagnosticLabel,
      remediation,
      isSlowStart,
      userFacingMessage,
    };
  }

  // 2. Successful termination
  if (exitCode === 0) {
    return {
      category: "success",
      processLayer,
      executable,
      exitCode: 0,
      signal: null,
      exitCodeHex,
      diagnosticLabel: "Completed Successfully",
      remediation: "",
      userFacingMessage: `${processLayer} completed successfully.`,
    };
  }

  // 3. Windows NTSTATUS / Wine specific exit codes
  if (rawHex === STATUS_DLL_NOT_FOUND_HEX) {
    const diagnosticLabel = "Missing Required Windows DLL / Dependency (0xC0000135)";
    const remediation =
      "A required Windows dynamic-link library (.dll) or redistributable was not found in the Proton prefix. Verify that required runtimes (Visual C++, DirectX, or XLive) are installed in the prefix.";
    return {
      category: "missing-dependency",
      processLayer,
      executable,
      exitCode,
      signal: signal ?? null,
      exitCodeHex,
      diagnosticLabel,
      remediation,
      userFacingMessage: buildUserFacingMessage(
        processLayer,
        executable,
        diagnosticLabel,
        exitCodeHex,
        remediation,
        outputSnippet,
      ),
    };
  }

  if (rawHex === STATUS_ACCESS_VIOLATION_HEX) {
    const diagnosticLabel = "Memory Access Violation (0xC0000005)";
    const remediation =
      "The process crashed due to an illegal memory access violation. This usually indicates incompatible mods, corrupted game data, or unhandled null pointers in script extenders.";
    return {
      category: "access-violation",
      processLayer,
      executable,
      exitCode,
      signal: signal ?? null,
      exitCodeHex,
      diagnosticLabel,
      remediation,
      userFacingMessage: buildUserFacingMessage(
        processLayer,
        executable,
        diagnosticLabel,
        exitCodeHex,
        remediation,
        outputSnippet,
      ),
    };
  }

  if (rawHex === STATUS_DOTNET_EXCEPTION_HEX) {
    const diagnosticLabel = ".NET Runtime Exception (0xE0434352)";
    const remediation =
      "An unhandled .NET runtime exception occurred. Ensure Wine Mono or Microsoft .NET Framework is properly installed in the prefix.";
    return {
      category: "dotnet-error",
      processLayer,
      executable,
      exitCode,
      signal: signal ?? null,
      exitCodeHex,
      diagnosticLabel,
      remediation,
      userFacingMessage: buildUserFacingMessage(
        processLayer,
        executable,
        diagnosticLabel,
        exitCodeHex,
        remediation,
        outputSnippet,
      ),
    };
  }

  if (rawHex === STATUS_SHUTDOWN_IN_PROGRESS_HEX) {
    const diagnosticLabel = "Wine Server / Session Shutdown (0xC000026B)";
    const remediation =
      "The Wine server or Windows session terminated while the application was active.";
    return {
      category: "terminated-by-signal",
      processLayer,
      executable,
      exitCode,
      signal: signal ?? null,
      exitCodeHex,
      diagnosticLabel,
      remediation,
      userFacingMessage: buildUserFacingMessage(
        processLayer,
        executable,
        diagnosticLabel,
        exitCodeHex,
        remediation,
        outputSnippet,
      ),
    };
  }

  // 4. Linux dynamic linker and permission errors
  if (exitCode === 127) {
    const isProton = processLayer === "proton-runtime";
    const diagnosticLabel = isProton
      ? "Proton Runner or Dynamic Library Missing (127)"
      : "Missing Linux Dynamic Library (127)";
    const remediation = isProton
      ? "The Proton runner script or a required Linux runtime dependency could not be found. Check your Steam Proton installation or custom Proton path."
      : "The executable or a dependent shared object (.so) could not be loaded by the Linux dynamic linker. Verify host package dependencies.";
    return {
      category: "missing-dependency",
      processLayer,
      executable,
      exitCode,
      signal: signal ?? null,
      exitCodeHex,
      diagnosticLabel,
      remediation,
      userFacingMessage: buildUserFacingMessage(
        processLayer,
        executable,
        diagnosticLabel,
        exitCodeHex,
        remediation,
        outputSnippet,
      ),
    };
  }

  if (exitCode === 126) {
    const diagnosticLabel = "Permission Denied / Non-Executable (126)";
    const remediation =
      "The file cannot be executed. Ensure the executable flag is set (chmod +x) and the filesystem is not mounted with 'noexec'.";
    return {
      category: "permission-denied",
      processLayer,
      executable,
      exitCode,
      signal: signal ?? null,
      exitCodeHex,
      diagnosticLabel,
      remediation,
      userFacingMessage: buildUserFacingMessage(
        processLayer,
        executable,
        diagnosticLabel,
        exitCodeHex,
        remediation,
        outputSnippet,
      ),
    };
  }

  // 5. POSIX signals (Segmentation Fault, Abort, Terminated, Force-Killed)
  if (signal === "SIGSEGV" || exitCode === 139) {
    const diagnosticLabel = "Segmentation Fault (SIGSEGV)";
    const remediation =
      "The application crashed due to an invalid memory reference. If running under Proton, check graphics drivers (Mesa/Nvidia) and DXVK/VKD3D compatibility.";
    return {
      category: "crash",
      processLayer,
      executable,
      exitCode,
      signal: signal ?? "SIGSEGV",
      exitCodeHex,
      diagnosticLabel,
      remediation,
      userFacingMessage: buildUserFacingMessage(
        processLayer,
        executable,
        diagnosticLabel,
        exitCodeHex,
        remediation,
        outputSnippet,
      ),
    };
  }

  if (signal === "SIGABRT" || exitCode === 134) {
    const diagnosticLabel = "Process Aborted (SIGABRT)";
    const remediation =
      "The process called abort(). Check process logs or terminal output for assertion failures.";
    return {
      category: "crash",
      processLayer,
      executable,
      exitCode,
      signal: signal ?? "SIGABRT",
      exitCodeHex,
      diagnosticLabel,
      remediation,
      userFacingMessage: buildUserFacingMessage(
        processLayer,
        executable,
        diagnosticLabel,
        exitCodeHex,
        remediation,
        outputSnippet,
      ),
    };
  }

  if (signal === "SIGKILL" || exitCode === 137) {
    const diagnosticLabel = "Forcefully Terminated (SIGKILL)";
    const remediation =
      "The process was forcefully terminated by SIGKILL, commonly by the Linux Out-Of-Memory (OOM) killer or Vortex supervisor escalation.";
    return {
      category: "terminated-by-signal",
      processLayer,
      executable,
      exitCode,
      signal: signal ?? "SIGKILL",
      exitCodeHex,
      diagnosticLabel,
      remediation,
      userFacingMessage: buildUserFacingMessage(
        processLayer,
        executable,
        diagnosticLabel,
        exitCodeHex,
        remediation,
        outputSnippet,
      ),
    };
  }

  if (signal === "SIGTERM" || exitCode === 143) {
    const diagnosticLabel = "Cleanly Terminated (SIGTERM)";
    const remediation = "The process group was terminated by SIGTERM.";
    return {
      category: "terminated-by-signal",
      processLayer,
      executable,
      exitCode,
      signal: signal ?? "SIGTERM",
      exitCodeHex,
      diagnosticLabel,
      remediation,
      userFacingMessage: buildUserFacingMessage(
        processLayer,
        executable,
        diagnosticLabel,
        exitCodeHex,
        remediation,
        outputSnippet,
      ),
    };
  }

  // 6. Launcher handoff failures
  if (processLayer === "launcher-handoff") {
    const diagnosticLabel = "Launcher Handoff Failed";
    const remediation =
      "The external launcher protocol handoff failed. Ensure the launcher (Steam, Heroic, or Lutris) is running and configured to handle URL commands.";
    return {
      category: "launcher-unavailable",
      processLayer,
      executable,
      exitCode,
      signal: signal ?? null,
      exitCodeHex,
      diagnosticLabel,
      remediation,
      userFacingMessage: buildUserFacingMessage(
        processLayer,
        executable,
        diagnosticLabel,
        exitCodeHex,
        remediation,
        outputSnippet,
      ),
    };
  }

  // 7. Generic fallback for other non-zero exit codes or unhandled signals
  const diagnosticLabel =
    exitCode !== null
      ? `Failed with Exit Code ${exitCode}`
      : `Terminated by Signal ${signal ?? "unknown"}`;
  const remediation = `The ${processLayer} process terminated unexpectedly. Check application logs for details.`;

  return {
    category: "unknown-failure",
    processLayer,
    executable,
    exitCode,
    signal: signal ?? null,
    exitCodeHex,
    diagnosticLabel,
    remediation,
    userFacingMessage: buildUserFacingMessage(
      processLayer,
      executable,
      diagnosticLabel,
      exitCodeHex,
      remediation,
      outputSnippet,
    ),
  };
}

function buildUserFacingMessage(
  processLayer: ProcessLayer,
  executable: string,
  diagnosticLabel: string,
  exitCodeHex: string | undefined,
  remediation: string,
  outputSnippet?: string,
): string {
  // Sanitize executable name for safe terminal/log display
  const sanitizedExecutable = executable.replace(/[^\x20-\x7E]/g, "?");
  const hexPart = exitCodeHex !== undefined ? ` (${exitCodeHex})` : "";
  let message = `Failed to run ${processLayer} "${sanitizedExecutable}": ${diagnosticLabel}${hexPart}. ${remediation}`;

  if (outputSnippet && outputSnippet.trim().length > 0) {
    const lines = outputSnippet.trim().split("\n");
    const lastLine = lines[lines.length - 1].replace(/[^\x20-\x7E]/g, "?").substring(0, 300);
    message += ` Output: "${lastLine}"`;
  }

  return message;
}
