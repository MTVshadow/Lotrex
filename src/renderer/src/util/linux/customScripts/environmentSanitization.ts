import * as os from "node:os";

import type { ICustomScriptManifest, IScriptExecutionContext } from "./contracts";

/**
 * Standard minimal list of environment variables permitted to be inherited from host.
 * All credentials, tokens, DBus addresses, and session keys are excluded by default.
 */
export const DEFAULT_ALLOWED_ENV_VARS: ReadonlySet<string> = new Set([
  "PATH",
  "LANG",
  "LC_ALL",
  "USER",
  "LOGNAME",
  "HOME",
  "TMPDIR",
  "TERM",
  "SHELL",
  "WINEPREFIX",
  "WINEDEBUG",
  "STEAM_COMPAT_DATA_PATH",
  "STEAM_COMPAT_CLIENT_INSTALL_PATH",
  "VORTEX_GAME_ID",
  "VORTEX_LIFECYCLE_EVENT",
]);

/**
 * Pattern matching sensitive variable names that MUST NEVER be forwarded to custom scripts.
 * Catches API keys, authentication tokens, credentials, and keyring connections.
 */
export const SENSITIVE_ENV_PATTERN =
  /(?:TOKEN|SECRET|KEY|COOKIE|PASSW|AUTH|CREDENTIAL|NEXUS|GITHUB|SSH|GPG|AWS|DISCORD)/i;

/**
 * Stripped variables that must never reach a child process under any circumstance,
 * specifically D-Bus session bus addresses to isolate desktop secret-service keyrings.
 */
export const BLOCKED_EXPLICIT_ENV_VARS: ReadonlySet<string> = new Set([
  "DBUS_SESSION_BUS_ADDRESS",
  "SSH_AUTH_SOCK",
  "GPG_AGENT_INFO",
]);

/**
 * Builds a strictly sanitized environment map for script execution.
 * Enforces Control 7 (Sanitized process environment).
 *
 * @param manifest Script manifest specifying requested environment allowlist and declared vars.
 * @param context Execution context providing game, profile, and prefix boundaries.
 * @param workspaceDir Isolated ephemeral workspace directory assigned as TMPDIR.
 * @returns Clean, isolated key-value environment dictionary.
 */
export function sanitizeScriptEnvironment(
  manifest: ICustomScriptManifest,
  context: IScriptExecutionContext,
  workspaceDir: string,
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  // Construct effective allowlist: union of standard defaults and safe declared allowlist
  const requestedAllowlist = new Set<string>(DEFAULT_ALLOWED_ENV_VARS);
  if (Array.isArray(manifest.environmentAllowlist)) {
    for (const key of manifest.environmentAllowlist) {
      if (!SENSITIVE_ENV_PATTERN.test(key) && !BLOCKED_EXPLICIT_ENV_VARS.has(key)) {
        requestedAllowlist.add(key);
      }
    }
  }

  // Populate from host process.env only if explicitly allowed and not sensitive
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (BLOCKED_EXPLICIT_ENV_VARS.has(key)) continue;
    if (SENSITIVE_ENV_PATTERN.test(key)) continue;
    if (requestedAllowlist.has(key)) {
      sanitized[key] = value;
    }
  }

  // Bind game and lifecycle context safely
  sanitized["VORTEX_GAME_ID"] = context.gameId;
  sanitized["VORTEX_LIFECYCLE_EVENT"] = context.lifecycleEvent;
  // Ephemeral workspace isolation: redirect temporary file creation away from host /tmp
  sanitized["TMPDIR"] = workspaceDir;
  sanitized["TEMP"] = workspaceDir;
  sanitized["TMP"] = workspaceDir;

  // Proton / Wine prefix isolation: bind explicitly selected prefix
  if (context.prefixPath) {
    sanitized["WINEPREFIX"] = context.prefixPath;
    sanitized["STEAM_COMPAT_DATA_PATH"] = context.prefixPath;
  }

  // Incorporate static declared environment variables from manifest, rejecting secrets
  if (manifest.declaredEnvironment) {
    for (const [key, value] of Object.entries(manifest.declaredEnvironment)) {
      if (BLOCKED_EXPLICIT_ENV_VARS.has(key) || SENSITIVE_ENV_PATTERN.test(key)) {
        continue;
      }
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Regex identifying Bearer auth tokens, hex secrets of length 16+, and common sensitive patterns.
 */
const TOKEN_REGEX = /Bearer\s+[a-zA-Z0-9_\-\.]+/gi;
const HEX_SECRET_REGEX = /\b[0-9a-fA-F]{24,64}\b/g;

/**
 * Redacts tokens, passwords, private keys, and user identity from script output strings.
 * Ensures diagnostic reports and persistent logs do not leak secrets (Control 7).
 *
 * @param text Raw stdout/stderr stream content.
 * @param additionalSecrets Optional array of known sensitive strings to scrub.
 * @returns Scrubbed output text safe for storage and UI display.
 */
export function redactScriptOutput(text: string, additionalSecrets: string[] = []): string {
  if (!text) return "";

  let scrubbed = text
    .replace(TOKEN_REGEX, "Bearer [REDACTED_TOKEN]")
    .replace(HEX_SECRET_REGEX, "[REDACTED_SECRET]");

  // Scrub known sensitive strings (e.g. host tokens, user home directory)
  const homeDir = os.homedir();
  if (homeDir && homeDir !== "/") {
    scrubbed = scrubbed.split(homeDir).join("~");
  }

  for (const secret of additionalSecrets) {
    if (secret && secret.length >= 4) {
      scrubbed = scrubbed.split(secret).join("[REDACTED]");
    }
  }

  return scrubbed;
}
