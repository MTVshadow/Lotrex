import * as path from "path";

import PromiseBB from "bluebird";

import * as fs from "../../../util/fs";
import getVortexPath from "../../../util/getVortexPath";
import { deBOM, truthy } from "../../../util/util";

/**
 * return the path where chrome stores its settings regarding disabled schemes
 *
 * @returns
 */
function chromePath(): PromiseBB<string> {
  const appPath = getVortexPath("appData");
  if (process.platform === "win32") {
    const userData =
      process.env.LOCALAPPDATA !== undefined
        ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data")
        : path.resolve(appPath, "..", "Local", "Google", "Chrome", "User Data");
    return fs
      .readFileAsync(path.join(userData, "Local State"), { encoding: "utf-8" })
      .then((state) => {
        try {
          const dat = JSON.parse(deBOM(state));
          const prof =
            truthy(dat) && truthy(dat.profile) && truthy(dat.profile.last_used)
              ? dat.profile.last_used
              : "Default";
          return PromiseBB.resolve(path.join(userData, prof, "Preferences"));
        } catch (err) {
          return PromiseBB.reject(err);
        }
      })
      .catch((err) =>
        ["ENOENT", "EBUSY", "EPERM", "EISDIR"].indexOf(err.code) !== -1
          ? PromiseBB.resolve(path.join(userData, "Default", "Preferences"))
          : PromiseBB.reject(err),
      );
  } else if (process.platform === "linux") {
    const home = process.env.HOME || "";
    const candidates = [
      path.join(appPath, "google-chrome", "Default", "Preferences"),
      path.join(appPath, "chromium", "Default", "Preferences"),
      path.join(appPath, "BraveSoftware", "Brave-Browser", "Default", "Preferences"),
      path.join(home, ".config", "google-chrome", "Default", "Preferences"),
      path.join(home, ".config", "chromium", "Default", "Preferences"),
    ];

    return PromiseBB.filter(candidates, (cand) =>
      fs
        .statAsync(cand)
        .then(() => true)
        .catch(() => false),
    ).then((existing) => existing[0] ?? candidates[0]);
  } else {
    return PromiseBB.resolve(path.resolve(appPath, "Google", "Chrome", "Default", "Preferences"));
  }
}

export default chromePath;
