import type { IGame } from "../../../types/IGame";

const VALID_LAUNCH_MODES = new Set(["auto", "native", "steam", "steam-proton", "wine"]);

export function validateGameRegistration(
  candidate: unknown,
  registeredGameIds: ReadonlySet<string> = new Set(),
): string[] {
  if (candidate === null || typeof candidate !== "object") {
    return ["game definition must be an object"];
  }

  const game = candidate as Partial<IGame>;
  const errors: string[] = [];
  const id = typeof game.id === "string" ? game.id.trim() : "";

  if (id.length === 0) errors.push("id must be a non-empty string");
  else if (registeredGameIds.has(id)) errors.push(`game id \"${id}\" is already registered`);

  if (typeof game.name !== "string" || game.name.trim().length === 0) {
    errors.push("name must be a non-empty string");
  }
  if (
    !Array.isArray(game.requiredFiles) ||
    game.requiredFiles.some((entry) => typeof entry !== "string")
  ) {
    errors.push("requiredFiles must be an array of strings");
  }

  if (typeof game.executable !== "function") {
    errors.push("executable must be a function");
  } else {
    try {
      const executable = game.executable(undefined);
      if (typeof executable !== "string" || executable.trim().length === 0) {
        errors.push("executable(undefined) must return a non-empty relative path");
      }
    } catch (err) {
      errors.push(`executable(undefined) threw: ${errorMessage(err)}`);
    }
  }

  if (typeof game.queryModPath !== "function") {
    errors.push("queryModPath must be a function");
  } else {
    try {
      const modPath = game.queryModPath("/vortex/game");
      if (typeof modPath !== "string" || modPath.trim().length === 0) {
        errors.push("queryModPath(gamePath) must return a non-empty path");
      }
    } catch (err) {
      errors.push(`queryModPath(gamePath) threw: ${errorMessage(err)}`);
    }
  }

  const platforms = game.capabilities?.platforms;
  for (const platform of ["linux", "win32", "darwin"] as const) {
    const capability = platforms?.[platform];
    if (capability?.launch !== undefined && !VALID_LAUNCH_MODES.has(capability.launch)) {
      errors.push(`capabilities.platforms.${platform}.launch is invalid`);
    }
    if (
      capability?.steamAppId !== undefined &&
      !["string", "number"].includes(typeof capability.steamAppId)
    ) {
      errors.push(`capabilities.platforms.${platform}.steamAppId must be a string or number`);
    }
  }

  return errors;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}
