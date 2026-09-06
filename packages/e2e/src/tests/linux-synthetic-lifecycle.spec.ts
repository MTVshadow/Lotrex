import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { test, expect } from "../fixtures/vortex-app";
import { stubOpenDialog } from "../helpers/dialogs";
import { writeStoredZip } from "../helpers/storedZip";
import { Timeouts } from "../helpers/timeouts";
import { ModsPage } from "../selectors/modsPage";
import { NavBar } from "../selectors/navbar";

test.describe("Synthetic Skyrim lifecycle", () => {
  test.use({ managedGameId: "skyrimse" });

  test("installs, deploys, and purges an offline asset and ESP archive", async ({
    managedGame,
    vortexApp,
    vortexWindow,
  }) => {
    const archivePath = path.join(os.tmpdir(), `vortex-synthetic-skyrim-${Date.now()}.zip`);
    const vanillaPath = path.join(managedGame.gamePath, "Data", "Textures", "synthetic.dds");
    const pluginPath = path.join(managedGame.gamePath, "Data", "Synthetic.esp");
    fs.writeFileSync(vanillaPath, "vanilla");
    writeStoredZip(archivePath, {
      "Synthetic.esp": "TES4 synthetic plugin fixture",
      "Textures/synthetic.dds": "modded asset",
    });

    try {
      await stubOpenDialog(vortexApp, archivePath);
      await new NavBar(vortexWindow).modsLink.click();
      const mods = new ModsPage(vortexWindow);
      await expect(mods.installFromFileButton).toBeVisible({ timeout: Timeouts.NETWORK });
      await mods.installFromFileButton.click();

      await expect(mods.modRow(/vortex-synthetic-skyrim/i)).toBeVisible({
        timeout: Timeouts.NETWORK,
      });
      await expect.poll(() => fs.existsSync(pluginPath), { timeout: Timeouts.NETWORK }).toBe(true);
      await expect
        .poll(() => fs.readFileSync(vanillaPath, "utf8"), {
          timeout: Timeouts.NETWORK,
        })
        .toBe("modded asset");

      await mods.purgeButton.click();
      const confirmation = vortexWindow
        .getByRole("dialog")
        .filter({ hasText: "Confirm purge" })
        .last();
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole("button", { name: "Continue" }).click();
      await expect(vortexWindow.getByText("Mods purged").first()).toBeVisible({
        timeout: Timeouts.NETWORK,
      });

      await expect.poll(() => fs.existsSync(pluginPath), { timeout: Timeouts.NETWORK }).toBe(false);
      await expect
        .poll(() => fs.readFileSync(vanillaPath, "utf8"), {
          timeout: Timeouts.NETWORK,
        })
        .toBe("vanilla");
    } finally {
      fs.rmSync(archivePath, { force: true });
    }
  });
});
