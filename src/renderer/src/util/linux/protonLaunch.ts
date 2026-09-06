import * as fs from "node:fs";
import * as path from "node:path";

export function getWinePrefixPath(compatDataPath: string): string {
  return path.join(compatDataPath, "pfx");
}

export function isWindowsExecutable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [".exe", ".bat", ".cmd"].includes(ext);
}

export function buildProtonEnvironment(
  compatDataPath: string,
  steamPath: string,
  existingEnv?: Record<string, string>,
  protonPath?: string,
  gamePath?: string,
): Record<string, string> {
  const environment: Record<string, string> = {
    ...existingEnv,
    STEAM_COMPAT_DATA_PATH: compatDataPath,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: steamPath,
    WINEPREFIX: getWinePrefixPath(compatDataPath),
  };

  if (protonPath) {
    environment.STEAM_COMPAT_TOOL_PATHS = protonPath;
  }

  if (gamePath) {
    environment.STEAM_COMPAT_MOUNTS = gamePath;

    const hasCustomD3D = [
      "d3d11.dll",
      "dxgi.dll",
      "d3d9.dll",
      "enbseries.ini",
      "ReShade.ini",
      "dxgi.ini",
    ].some((fileName) => {
      try {
        fs.statSync(path.join(gamePath, fileName));
        return true;
      } catch {
        return false;
      }
    });

    if (hasCustomD3D) {
      const overrides = "d3d11=n,b;dxgi=n,b;d3d9=n,b";
      environment.WINEDLLOVERRIDES = environment.WINEDLLOVERRIDES
        ? `${environment.WINEDLLOVERRIDES};${overrides}`
        : overrides;
    }
  }

  return environment;
}

export function buildProtonCommand(
  protonPath: string,
  exePath: string,
  args: string[],
): { executable: string; args: string[] } {
  return {
    executable: path.join(protonPath, "proton"),
    args: ["run", exePath, ...args],
  };
}
