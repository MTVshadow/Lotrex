import * as path from "node:path";

export const LINUX_NAME_MAX_BYTES = 255;
export const LINUX_PATH_MAX_BYTES = 4096;

export interface ILinuxPathLimitViolation {
  actualBytes: number;
  kind: "component" | "path";
  limitBytes: number;
  path: string;
  component?: string;
}

export function findLinuxPathLimitViolation(
  inputPath: string,
  platform: NodeJS.Platform = process.platform,
): ILinuxPathLimitViolation | undefined {
  if (platform !== "linux") return undefined;

  const pathBytes = Buffer.byteLength(inputPath, "utf8");
  if (pathBytes > LINUX_PATH_MAX_BYTES) {
    return {
      actualBytes: pathBytes,
      kind: "path",
      limitBytes: LINUX_PATH_MAX_BYTES,
      path: inputPath,
    };
  }

  const component = inputPath
    .split(path.posix.sep)
    .find((value) => Buffer.byteLength(value, "utf8") > LINUX_NAME_MAX_BYTES);
  if (component !== undefined) {
    return {
      actualBytes: Buffer.byteLength(component, "utf8"),
      component,
      kind: "component",
      limitBytes: LINUX_NAME_MAX_BYTES,
      path: inputPath,
    };
  }
  return undefined;
}

export function assertLinuxPathLimits(
  inputPaths: Iterable<string>,
  platform: NodeJS.Platform = process.platform,
): void {
  for (const inputPath of inputPaths) {
    const violation = findLinuxPathLimitViolation(inputPath, platform);
    if (violation === undefined) continue;
    const subject =
      violation.kind === "component"
        ? `filename component '${violation.component}'`
        : "complete path";
    const err = new Error(
      `The ${subject} uses ${violation.actualBytes} UTF-8 bytes, exceeding the Linux limit of ${violation.limitBytes}: ${violation.path}`,
    );
    err["actualBytes"] = violation.actualBytes;
    err["code"] = "ENAMETOOLONG";
    err["limitBytes"] = violation.limitBytes;
    err["path"] = violation.path;
    throw err;
  }
}
