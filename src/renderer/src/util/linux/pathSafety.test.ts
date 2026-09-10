import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../fs", async () => {
  const native = await import("node:fs/promises");
  return {
    lstatAsync: native.lstat,
    readlinkAsync: native.readlink,
    statAsync: native.stat,
  };
});

import {
  assertLinuxDestinationSafety,
  assertLinuxExtractionSafety,
  assertLinuxPathHasNoSymlinkAncestors,
  isWithinRoot,
} from "./pathSafety";

describe("Linux managed path safety and extraction preflight", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
  });

  async function temporaryDirectory(): Promise<string> {
    const result = await fs.mkdtemp(path.join(os.tmpdir(), "vortex-path-safety-"));
    roots.push(result);
    return result;
  }

  describe("isWithinRoot", () => {
    it("recognizes contained subpaths and rejects root escapes", () => {
      expect(isWithinRoot("/games/skyrim", "/games/skyrim/Data/textures")).toBe(true);
      expect(isWithinRoot("/games/skyrim", "/games/skyrim")).toBe(true);
      expect(isWithinRoot("/games/skyrim", "/games/skyrim/../other")).toBe(false);
      expect(isWithinRoot("/games/skyrim", "/etc/passwd")).toBe(false);
    });
  });

  describe("assertLinuxPathHasNoSymlinkAncestors", () => {
    it("allows ordinary existing and not-yet-created parents", async () => {
      const root = await temporaryDirectory();
      await fs.mkdir(path.join(root, "textures"));

      await expect(
        assertLinuxPathHasNoSymlinkAncestors(
          root,
          path.join(root, "textures", "armor.dds"),
          "linux",
        ),
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
        assertLinuxPathHasNoSymlinkAncestors(
          root,
          path.join(root, "textures", "armor.dds"),
          "linux",
        ),
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

  describe("assertLinuxExtractionSafety preflight", () => {
    it("allows valid planned file paths inside extraction root", async () => {
      const root = await temporaryDirectory();
      await fs.mkdir(path.join(root, "meshes"));

      const planned = [
        path.join(root, "meshes", "armor.nif"),
        path.join(root, "textures", "diffuse.dds"),
        path.join(root, "new_folder", "sub", "config.json"),
      ];

      await expect(
        assertLinuxExtractionSafety(root, planned, { platform: "linux" }),
      ).resolves.toBeUndefined();
    });

    it("rejects Zip-Slip lexical root escape", async () => {
      const root = await temporaryDirectory();
      const malicious = [
        path.join(root, "textures", "normal.dds"),
        path.join(root, "..", "..", "etc", "cron.d", "malicious"),
      ];

      await expect(
        assertLinuxExtractionSafety(root, malicious, { platform: "linux" }),
      ).rejects.toMatchObject({
        code: "EDEPLOYMENTOUTSIDEROOT",
      });
    });

    it("rejects oversized component length (>255 UTF-8 bytes)", async () => {
      const root = await temporaryDirectory();
      const longName = "a".repeat(256);
      const planned = [path.join(root, "Data", longName)];

      await expect(
        assertLinuxExtractionSafety(root, planned, { platform: "linux" }),
      ).rejects.toMatchObject({
        code: "ENAMETOOLONG",
        limitBytes: 255,
      });
    });

    it("rejects hostile symlink at leaf pointing outside destination root", async () => {
      const root = await temporaryDirectory();
      const outside = await temporaryDirectory();
      const outsideFile = path.join(outside, "target_outside.txt");
      await fs.writeFile(outsideFile, "sensitive data");

      const hostileLink = path.join(root, "redirect.txt");
      await fs.symlink(outsideFile, hostileLink);

      const planned = [hostileLink];

      await expect(
        assertLinuxExtractionSafety(root, planned, { platform: "linux" }),
      ).rejects.toMatchObject({
        code: "EDEPLOYMENTSYMLINK",
        path: hostileLink,
      });
    });

    it("rejects broken dangling symlink at extraction destination", async () => {
      const root = await temporaryDirectory();
      const brokenLink = path.join(root, "dangling.txt");
      await fs.symlink(path.join(root, "non_existent.txt"), brokenLink);

      const planned = [brokenLink];

      await expect(
        assertLinuxExtractionSafety(root, planned, { platform: "linux" }),
      ).rejects.toMatchObject({
        code: "EDEPLOYMENTBROKENSYMLINK",
        path: brokenLink,
      });
    });

    it("rejects special POSIX device (FIFO) at extraction destination", async () => {
      const root = await temporaryDirectory();
      const fifoPath = path.join(root, "named_pipe");
      try {
        const { execSync } = await import("node:child_process");
        execSync(`mkfifo "${fifoPath}"`);
      } catch {
        return;
      }

      await expect(
        assertLinuxExtractionSafety(root, [fifoPath], { platform: "linux" }),
      ).rejects.toMatchObject({
        code: "EDEPLOYMENTSPECIALDEVICE",
        deviceType: "fifo",
        path: fifoPath,
      });
    });

    it("is completely bypassed on non-Linux platforms", async () => {
      const root = await temporaryDirectory();
      const outside = path.join(root, "..", "outside.txt");

      await expect(
        assertLinuxExtractionSafety(root, [outside], { platform: "win32" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("assertLinuxDestinationSafety (TOCTOU destination race protection)", () => {
    it("allows valid destination in managed root and returns parent identity", async () => {
      const root = await temporaryDirectory();
      const parent = path.join(root, "Data", "textures");
      await fs.mkdir(parent, { recursive: true });
      const target = path.join(parent, "diffuse.dds");

      const identity = await assertLinuxDestinationSafety(root, target, undefined, "linux");
      expect(identity).toBeDefined();
      expect(identity?.dev).toBeTypeOf("number");
      expect(identity?.ino).toBeTypeOf("number");

      // Verify passing the expected identity succeeds when parent hasn't changed
      const verified = await assertLinuxDestinationSafety(root, target, identity, "linux");
      expect(verified).toEqual(identity);
    });

    it("rejects target escaping managed root", async () => {
      const root = await temporaryDirectory();
      const outside = path.join(root, "..", "outside.txt");

      await expect(
        assertLinuxDestinationSafety(root, outside, undefined, "linux"),
      ).rejects.toMatchObject({
        code: "EDEPLOYMENTOUTSIDEROOT",
      });
    });

    it("detects TOCTOU parent directory swapping race and rejects mutation", async () => {
      const root = await temporaryDirectory();
      const parentA = path.join(root, "parentA");
      const parentB = path.join(root, "parentB");
      await fs.mkdir(parentA, { recursive: true });
      await fs.mkdir(parentB, { recursive: true });

      const target = path.join(parentA, "mod.esp");
      const initialIdentity = await assertLinuxDestinationSafety(root, target, undefined, "linux");
      expect(initialIdentity).toBeDefined();

      // Simulate an attacker swapping parentA with parentB (or replacing with another inode)
      const fakeIdentity = { dev: initialIdentity!.dev, ino: initialIdentity!.ino + 999999 };

      await expect(
        assertLinuxDestinationSafety(root, target, fakeIdentity, "linux"),
      ).rejects.toMatchObject({
        code: "EDEPLOYMENTPARENTCHANGED",
      });
    });

    it("rejects when parent directory is replaced with a symlink", async () => {
      const root = await temporaryDirectory();
      const outside = await temporaryDirectory();
      const symlinkParent = path.join(root, "sym_parent");
      await fs.symlink(outside, symlinkParent);
      const target = path.join(symlinkParent, "payload.dll");

      await expect(
        assertLinuxDestinationSafety(root, target, undefined, "linux"),
      ).rejects.toMatchObject({
        code: "EDEPLOYMENTSYMLINK",
      });
    });

    it("rejects when parent directory disappeared while expected identity was supplied", async () => {
      const root = await temporaryDirectory();
      const parent = path.join(root, "temporary_parent");
      await fs.mkdir(parent);
      const target = path.join(parent, "file.txt");
      const initialIdentity = await assertLinuxDestinationSafety(root, target, undefined, "linux");

      await fs.rm(parent, { recursive: true });

      await expect(
        assertLinuxDestinationSafety(root, target, initialIdentity, "linux"),
      ).rejects.toMatchObject({
        code: "EDEPLOYMENTPARENTCHANGED",
      });
    });

    it("rejects special POSIX device (FIFO) at destination", async () => {
      const root = await temporaryDirectory();
      const parent = path.join(root, "sub");
      await fs.mkdir(parent);
      const fifoPath = path.join(parent, "device_node");

      try {
        const { execSync } = await import("node:child_process");
        execSync(`mkfifo "${fifoPath}"`);
      } catch {
        return;
      }

      await expect(
        assertLinuxDestinationSafety(root, fifoPath, undefined, "linux"),
      ).rejects.toMatchObject({
        code: "EDEPLOYMENTSPECIALDEVICE",
        deviceType: "fifo",
      });
    });

    it("is completely bypassed on non-Linux platforms", async () => {
      const root = await temporaryDirectory();
      const outside = path.join(root, "..", "outside.txt");

      await expect(
        assertLinuxDestinationSafety(root, outside, undefined, "win32"),
      ).resolves.toBeUndefined();
    });
  });
});
