import * as path from "node:path";

import type { ILinuxProtonIssue } from "../types";

export interface ILinuxProtonAssessment {
  appId?: string;
  executablePath?: string;
  gameName?: string;
  platform: NodeJS.Platform;
  prefixPath?: string;
  protonPath?: string;
  steamPath?: string;
  store?: string;
}

export function assessLinuxProton(input: ILinuxProtonAssessment): ILinuxProtonIssue | undefined {
  if (
    input.platform !== "linux" ||
    input.store !== "steam" ||
    !input.executablePath ||
    ![".exe", ".bat", ".cmd"].includes(path.extname(input.executablePath).toLowerCase())
  ) {
    return undefined;
  }

  const shared = {
    appId: input.appId,
    executablePath: input.executablePath,
    gameName: input.gameName,
    prefixPath: input.prefixPath,
    steamPath: input.steamPath,
  };
  if (!input.steamPath) return { ...shared, reason: "steam-not-found" };
  if (!input.appId) return { ...shared, reason: "app-id-not-found" };
  if (!input.prefixPath) return { ...shared, reason: "prefix-not-found" };
  if (!input.protonPath) return { ...shared, reason: "runtime-not-found" };
  return undefined;
}
