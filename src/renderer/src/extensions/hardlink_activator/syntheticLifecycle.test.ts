import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IExtensionApi } from "../../types/IExtensionContext";
import LinkingDeployment from "../mod_management/LinkingDeployment";
import type { IUnavailableReason } from "../mod_management/types/IDeploymentMethod";
import type BlacklistSet from "../mod_management/util/BlacklistSet";

vi.mock("../../util/api", () => ({
  UserCanceled: class UserCanceled extends Error {},
  getGame: () => ({ directoryCleaning: "tag", requiresCleanup: false }),
}));

vi.mock("../../actions/notifications", () => ({ addNotification: (value: unknown) => value }));
vi.mock("../../logging", () => ({ log: vi.fn() }));
vi.mock("../../util/selectors", () => ({ activeGameId: () => "skyrimse" }));
vi.mock("../../util/util", () => ({ truthy: (value: unknown) => Boolean(value) }));

vi.mock("../../util/fs", async () => {
  const native = await import("node:fs/promises");
  return {
    ensureDirAsync: async (dirPath: string, onCreated?: (createdPath: string) => unknown) => {
      try {
        await native.stat(dirPath);
      } catch {
        await native.mkdir(dirPath, { recursive: true });
        await onCreated?.(dirPath);
      }
    },
    linkAsync: native.link,
    lstatAsync: native.lstat,
    readFileAsync: native.readFile,
    readlinkAsync: native.readlink,
    readdirAsync: native.readdir,
    removeAsync: (filePath: string) => native.rm(filePath, { force: true, recursive: true }),
    renameAsync: native.rename,
    statAsync: native.stat,
    symlinkAsync: native.symlink,
    unlinkAsync: native.unlink,
    writeFileAsync: native.writeFile,
  };
});

vi.mock("../../util/fsAtomic", async () => {
  const native = await import("node:fs/promises");
  return {
    writeFileAtomic: (filePath: string, input: string | Buffer) =>
      native.writeFile(filePath, input),
  };
});

describe("synthetic Skyrim deployment lifecycle", () => {
  let root: string;
  let stagingPath: string;
  let dataPath: string;
  let activator: SyntheticHardlinkDeployment;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-skyrim-lifecycle-"));
    stagingPath = path.join(root, "staging");
    dataPath = path.join(root, "Skyrim Special Edition", "Data");
    await fs.mkdir(path.join(stagingPath, "asset-mod", "textures"), { recursive: true });
    await fs.mkdir(path.join(stagingPath, "plugin-mod"), { recursive: true });
    await fs.mkdir(path.join(dataPath, "textures"), { recursive: true });
    await fs.writeFile(path.join(stagingPath, "asset-mod", "textures", "synthetic.dds"), "asset");
    await fs.writeFile(path.join(stagingPath, "plugin-mod", "Synthetic.esp"), "TES4");
    await fs.writeFile(path.join(dataPath, "textures", "synthetic.dds"), "vanilla");

    const state = { settings: { mods: { cleanupOnDeploy: false } } };
    const api = {
      store: { dispatch: vi.fn(), getState: () => state },
      translate: (value: string) => value,
      showErrorNotification: vi.fn(),
    } as unknown as IExtensionApi;
    activator = new SyntheticHardlinkDeployment(api);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("deploys an asset and plugin, then removes them and restores the vanilla file", async () => {
    const normalize = (value: string) => value.toLocaleLowerCase("en-US");
    const blacklist = { has: () => false } as unknown as BlacklistSet;

    await activator.prepare(dataPath, true, [], normalize);
    await activator.activate(path.join(stagingPath, "asset-mod"), "asset-mod", "", blacklist);
    await activator.activate(path.join(stagingPath, "plugin-mod"), "plugin-mod", "", blacklist);
    const deployed = await activator.finalize("skyrimse", dataPath, stagingPath);

    expect(deployed.map((entry) => entry.relPath).sort()).toEqual([
      "Synthetic.esp",
      path.join("textures", "synthetic.dds"),
    ]);
    expect(await fs.readFile(path.join(dataPath, "textures", "synthetic.dds"), "utf8")).toBe(
      "asset",
    );
    expect(await fs.readFile(path.join(dataPath, "Synthetic.esp"), "utf8")).toBe("TES4");

    const source = await fs.stat(path.join(stagingPath, "plugin-mod", "Synthetic.esp"));
    const target = await fs.stat(path.join(dataPath, "Synthetic.esp"));
    expect(target.ino).toBe(source.ino);

    await activator.prepare(dataPath, true, deployed, normalize);
    const afterUndeploy = await activator.finalize("skyrimse", dataPath, stagingPath);

    expect(afterUndeploy).toEqual([]);
    await expect(fs.stat(path.join(dataPath, "Synthetic.esp"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await fs.readFile(path.join(dataPath, "textures", "synthetic.dds"), "utf8")).toBe(
      "vanilla",
    );
  });

  it("does not remove a file replaced by Steam validation before purge", async () => {
    const normalize = (value: string) => value.toLocaleLowerCase("en-US");
    const blacklist = { has: () => false } as unknown as BlacklistSet;
    const pluginPath = path.join(dataPath, "Synthetic.esp");

    await activator.prepare(dataPath, true, [], normalize);
    await activator.activate(path.join(stagingPath, "plugin-mod"), "plugin-mod", "", blacklist);
    const deployed = await activator.finalize("skyrimse", dataPath, stagingPath);
    await activator.prepare(dataPath, true, deployed, normalize);

    await fs.unlink(pluginPath);
    await fs.writeFile(pluginPath, "steam-validated");

    const afterPurge = await activator.finalize("skyrimse", dataPath, stagingPath);

    expect(afterPurge).toEqual(
      expect.arrayContaining([expect.objectContaining({ relPath: "Synthetic.esp" })]),
    );
    await expect(fs.readFile(pluginPath, "utf8")).resolves.toBe("steam-validated");
  });
});

class SyntheticHardlinkDeployment extends LinkingDeployment {
  public priority = 1;

  constructor(api: IExtensionApi) {
    super("hardlink_activator", "Hardlink Deployment", "Synthetic lifecycle", true, api);
  }

  public isSupported(): IUnavailableReason {
    return undefined;
  }

  protected async linkFile(linkPath: string, sourcePath: string, dirTags?: boolean): Promise<void> {
    await this.ensureDir(path.dirname(linkPath), dirTags);
    await fs.link(sourcePath, linkPath);
  }

  protected async unlinkFile(linkPath: string): Promise<void> {
    await fs.unlink(linkPath);
  }

  protected async purgeLinks(): Promise<void> {
    return undefined;
  }

  protected async isLink(linkPath: string, sourcePath: string): Promise<boolean> {
    try {
      const [link, source] = await Promise.all([fs.stat(linkPath), fs.stat(sourcePath)]);
      return link.ino === source.ino;
    } catch (err: any) {
      if (err?.code === "ENOENT") return false;
      throw err;
    }
  }

  protected canRestore(): boolean {
    return true;
  }
}
