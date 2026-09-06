import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../fs", async () => {
  const native = await import("node:fs/promises");
  return { lstatAsync: native.lstat };
});

import { assertLinuxPathHasNoSymlinkAncestors } from "./pathSafety";

describe("Linux managed path safety", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
  });

  async function temporaryDirectory(): Promise<string> {
    const result = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-path-safety-"));
    roots.push(result);
    return result;
  }

  it("allows ordinary existing and not-yet-created parents", async () => {
    const root = await temporaryDirectory();
    await fs.mkdir(path.join(root, "textures"));

    await expect(
      assertLinuxPathHasNoSymlinkAncestors(root, path.join(root, "textures", "armor.dds"), "linux"),
    ).resolves.toBeUndefined();
    await expect(
      assertLinuxPathHasNoSymlinkAncestors(root, path.join(root, "new", "file.dds"), "linux"),
    ).resolves.toBeUndefined();
  });

  it("rejects a symlinked directory that escapes the managed root", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await fs.symlink(outside, path.join(root, "textures"));

    await expect(
      assertLinuxPathHasNoSymlinkAncestors(root, path.join(root, "textures", "armor.dds"), "linux"),
    ).rejects.toMatchObject({ code: "EDEPLOYMENTSYMLINK", path: path.join(root, "textures") });
  });

  it("rejects broken links and link loops without following them", async () => {
    const root = await temporaryDirectory();
    await fs.symlink(path.join(root, "missing"), path.join(root, "broken"));
    await fs.symlink("loop", path.join(root, "loop"));

    for (const name of ["broken", "loop"]) {
      await expect(
        assertLinuxPathHasNoSymlinkAncestors(root, path.join(root, name, "file.dds"), "linux"),
      ).rejects.toMatchObject({ code: "EDEPLOYMENTSYMLINK", path: path.join(root, name) });
    }
  });

  it("rejects lexical traversal outside the root and is inactive off Linux", async () => {
    const root = await temporaryDirectory();
    const outsidePath = path.join(root, "..", "outside", "file.dds");

    await expect(
      assertLinuxPathHasNoSymlinkAncestors(root, outsidePath, "linux"),
    ).rejects.toMatchObject({ code: "EDEPLOYMENTOUTSIDEROOT", path: outsidePath });
    await expect(
      assertLinuxPathHasNoSymlinkAncestors(root, outsidePath, "win32"),
    ).resolves.toBeUndefined();
  });
});
