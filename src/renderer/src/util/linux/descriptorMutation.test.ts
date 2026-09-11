import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isDescriptorMutationSupported,
  openLinuxDestinationHandle,
  withLinuxDescriptorMutation,
} from "./descriptorMutation";

describe("Linux descriptor-bound deployment mutations (TOCTOU remediation)", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((r) => fs.rm(r, { force: true, recursive: true }).catch(() => {})),
    );
  });

  async function createTempRoot(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-toctou-"));
    tempRoots.push(dir);
    return dir;
  }

  it("detects descriptor mutation support on Linux", () => {
    if (process.platform === "linux") {
      expect(isDescriptorMutationSupported("linux")).toBe(true);
    }
    expect(isDescriptorMutationSupported("win32")).toBe(false);
  });

  it("rejects paths escaping the declared managed root", async () => {
    const root = await createTempRoot();
    const outsideTarget = path.join(root, "..", "outside", "file.txt");

    await expect(
      withLinuxDescriptorMutation(root, outsideTarget, async () => {}),
    ).rejects.toMatchObject({
      code: "EDEPLOYMENTOUTSIDEROOT",
    });
  });

  it("rejects ancestor directories that are symbolic links", async () => {
    const root = await createTempRoot();
    const realDir = await createTempRoot();
    const symlinkDir = path.join(root, "symlinked-parent");
    await fs.symlink(realDir, symlinkDir);

    const target = path.join(symlinkDir, "mod.esp");

    await expect(withLinuxDescriptorMutation(root, target, async () => {})).rejects.toMatchObject({
      code: "EDEPLOYMENTSYMLINK",
    });
  });

  it("rejects invalid leaf filenames containing directory separators or relative escapes", async () => {
    const root = await createTempRoot();
    const destDir = path.join(root, "sub");
    await fs.mkdir(destDir);
    const target = path.join(destDir, "file.txt");

    await withLinuxDescriptorMutation(
      root,
      target,
      async (handle) => {
        expect(() => handle.fdPath("../evil")).toThrowError(/Invalid leaf filename/);
        expect(() => handle.fdPath("sub/file.txt")).toThrowError(/Invalid leaf filename/);
        expect(() => handle.fdPath("")).toThrowError(/Invalid leaf filename/);
        expect(() => handle.fdPath(".")).toThrowError(/Invalid leaf filename/);
      },
      { skipOwnershipCheck: true },
    );
  });

  it("immunizes file creation against concurrent directory symlink swaps (TOCTOU defense)", async () => {
    const root = await createTempRoot();
    const legitimateParent = path.join(root, "Data");
    await fs.mkdir(legitimateParent);

    const evilDir = await createTempRoot();
    const targetPath = path.join(legitimateParent, "target.esp");

    const sourceFile = path.join(root, "source.esp");
    await fs.writeFile(sourceFile, "original-esp-data");

    // Open destination handle
    const handle = await openLinuxDestinationHandle(root, targetPath, {
      skipOwnershipCheck: true,
    });

    try {
      // Simulate concurrent attacker race condition:
      // Attacker moves legitimate directory and replaces it with a symlink to evilDir
      const legitimateOld = path.join(root, "Data.renamed");
      await fs.rename(legitimateParent, legitimateOld);
      await fs.symlink(evilDir, legitimateParent);

      // Now perform mutation via descriptor handle
      await handle.linkFile(sourceFile, "target.esp");

      // Verify that evilDir was NOT touched (attacker failed)
      const evilFiles = await fs.readdir(evilDir);
      expect(evilFiles).toEqual([]);

      // Verify that the file was created in the original verified directory inode
      const originalFiles = await fs.readdir(legitimateOld);
      expect(originalFiles).toContain("target.esp");
      const content = await fs.readFile(path.join(legitimateOld, "target.esp"), "utf8");
      expect(content).toBe("original-esp-data");
    } finally {
      await handle.close();
    }
  });

  it("performs atomic backup and restore operations within the directory handle", async () => {
    const root = await createTempRoot();
    const dataDir = path.join(root, "Data");
    await fs.mkdir(dataDir);
    const targetPath = path.join(dataDir, "vanilla.ini");

    await fs.writeFile(targetPath, "vanilla-config");

    await withLinuxDescriptorMutation(
      root,
      targetPath,
      async (handle) => {
        // 1. Create backup
        await handle.ensureBackup("vanilla.ini", ".vortex_backup");

        // vanilla.ini should now be vanilla.ini.vortex_backup
        const filesAfterBackup = await fs.readdir(dataDir);
        expect(filesAfterBackup).toContain("vanilla.ini.vortex_backup");
        expect(filesAfterBackup).not.toContain("vanilla.ini");

        // 2. Restore backup
        await handle.restoreBackup("vanilla.ini", ".vortex_backup");
        const filesAfterRestore = await fs.readdir(dataDir);
        expect(filesAfterRestore).toContain("vanilla.ini");
        expect(filesAfterRestore).not.toContain("vanilla.ini.vortex_backup");

        const content = await fs.readFile(targetPath, "utf8");
        expect(content).toBe("vanilla-config");
      },
      { skipOwnershipCheck: true },
    );
  });

  it("creates and unlinks symbolic links within the descriptor handle", async () => {
    const root = await createTempRoot();
    const dataDir = path.join(root, "Data");
    await fs.mkdir(dataDir);
    const targetPath = path.join(dataDir, "mod.esp");

    const sourceFile = path.join(root, "mod-source.esp");
    await fs.writeFile(sourceFile, "mod-data");

    await withLinuxDescriptorMutation(
      root,
      targetPath,
      async (handle) => {
        // 1. Create symlink
        await handle.symlinkFile(sourceFile, "mod.esp");
        const stat = await handle.statFile("mod.esp");
        expect(stat.isSymbolicLink()).toBe(true);

        // 2. Unlink symlink
        await handle.unlinkFile("mod.esp");
        await expect(handle.statFile("mod.esp")).rejects.toMatchObject({ code: "ENOENT" });
      },
      { skipOwnershipCheck: true },
    );
  });

  it("replaces existing links safely on EEXIST", async () => {
    const root = await createTempRoot();
    const dataDir = path.join(root, "Data");
    await fs.mkdir(dataDir);
    const targetPath = path.join(dataDir, "duplicate.esp");

    const source1 = path.join(root, "source1.esp");
    const source2 = path.join(root, "source2.esp");
    await fs.writeFile(source1, "version-1");
    await fs.writeFile(source2, "version-2");

    await withLinuxDescriptorMutation(
      root,
      targetPath,
      async (handle) => {
        await handle.linkFile(source1, "duplicate.esp");
        expect(await fs.readFile(path.join(dataDir, "duplicate.esp"), "utf8")).toBe("version-1");

        // Overwrite existing link
        await handle.linkFile(source2, "duplicate.esp");
        expect(await fs.readFile(path.join(dataDir, "duplicate.esp"), "utf8")).toBe("version-2");
      },
      { skipOwnershipCheck: true },
    );
  });

  it("rejects world-writable directories without sticky bit (Invariant 2)", async () => {
    const root = await createTempRoot();
    const unsafeDir = path.join(root, "unsafe-dir");
    await fs.mkdir(unsafeDir);

    // Set 0o777 (world-writable without sticky bit)
    await fs.chmod(unsafeDir, 0o777);

    const targetPath = path.join(unsafeDir, "file.txt");

    await expect(
      withLinuxDescriptorMutation(root, targetPath, async () => {}),
    ).rejects.toMatchObject({
      code: "EDEPLOYMENTUNSAFEPERMISSIONS",
    });
  });

  it("accepts world-writable directories with sticky bit (Invariant 2)", async () => {
    const root = await createTempRoot();
    const stickyDir = path.join(root, "sticky-dir");
    await fs.mkdir(stickyDir);

    // Set 0o1777 (world-writable WITH sticky bit, like /tmp)
    await fs.chmod(stickyDir, 0o1777);

    const targetPath = path.join(stickyDir, "file.txt");

    await expect(
      withLinuxDescriptorMutation(
        root,
        targetPath,
        async (handle) => {
          expect(handle.parentPath).toBe(stickyDir);
        },
        { skipOwnershipCheck: false },
      ),
    ).resolves.toBeUndefined();
  });

  it("detects parent directory identity change when expectedParentIdentity is passed", async () => {
    const root = await createTempRoot();
    const legitimateDir = path.join(root, "legit");
    await fs.mkdir(legitimateDir);
    const targetPath = path.join(legitimateDir, "file.txt");

    // Pass invalid expected identity
    await expect(
      withLinuxDescriptorMutation(root, targetPath, async () => {}, {
        expectedParentIdentity: { dev: 12345, ino: 999999 },
        skipOwnershipCheck: true,
      }),
    ).rejects.toMatchObject({
      code: "EDEPLOYMENTPARENTCHANGED",
    });
  });

  it("supports atomic move deployment through descriptor handle", async () => {
    const root = await createTempRoot();
    const staging = path.join(root, "staging");
    const data = path.join(root, "Data");
    await fs.mkdir(staging);
    await fs.mkdir(data);

    const sourceFile = path.join(staging, "move-mod.esp");
    await fs.writeFile(sourceFile, "move-data");

    const targetPath = path.join(data, "move-mod.esp");

    await withLinuxDescriptorMutation(
      root,
      targetPath,
      async (handle) => {
        // Atomic move from staging to descriptor
        await fs.rename(sourceFile, handle.fdPath("move-mod.esp"));

        // File is in data
        expect(await fs.readdir(data)).toContain("move-mod.esp");
        expect(await fs.readdir(staging)).toEqual([]);

        // Atomic move back to staging
        await fs.rename(handle.fdPath("move-mod.esp"), sourceFile);
        expect(await fs.readdir(data)).toEqual([]);
        expect(await fs.readdir(staging)).toContain("move-mod.esp");
      },
      { skipOwnershipCheck: true },
    );
  });
});
