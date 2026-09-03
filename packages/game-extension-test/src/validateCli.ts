#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";

import minimist from "minimist";

import { validateGameExtensionDir } from "./validateExtension";

async function main() {
  const argv = minimist(process.argv.slice(2).filter((a) => a !== "--"));
  const gameArg = argv._[0] || argv.game;
  const isJson = argv.json === true;

  const repoRoot = path.resolve(__dirname, "../../..");
  const extensionsGamesDir = path.join(repoRoot, "extensions", "games");

  if (!gameArg) {
    console.error("Використання: pnpm game-extension validate <game-extension-folder> [--json]");
    console.error("Приклад:    pnpm game-extension validate game-skyrimse");
    process.exit(1);
  }

  let targetDir = path.resolve(gameArg);
  if (!fs.existsSync(targetDir)) {
    targetDir = path.join(extensionsGamesDir, gameArg);
  }

  if (!fs.existsSync(targetDir)) {
    console.error(`Каталог розширення '${gameArg}' не знайдено.`);
    process.exit(1);
  }

  const report = await validateGameExtensionDir(targetDir);

  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.valid ? 0 : 1);
  }

  console.log(`\nВалідація розширення гри: ${report.gameId}`);
  console.log(`Каталог: ${targetDir}`);
  if (report.info.name) {
    console.log(`Назва гри: ${report.info.name}`);
  }
  console.log(`Інсталяторів зареєстровано: ${report.info.installersCount}`);
  console.log(`Linux capabilities: ${report.info.hasLinuxCapabilities ? "ТАК" : "НІ"}`);
  if (report.info.launchMode) {
    console.log(`Режим запуску на Linux: ${report.info.launchMode}`);
  }
  if (report.info.steamAppId) {
    console.log(`Steam App ID: ${report.info.steamAppId}`);
  }

  if (report.warnings.length > 0) {
    console.log("\nПопередження:");
    for (const warning of report.warnings) {
      console.log(`  [!] ${warning}`);
    }
  }

  if (report.errors.length > 0) {
    console.log("\nПомилки контракту:");
    for (const error of report.errors) {
      console.log(`  [X] ${error}`);
    }
    console.log("\nРезультат: НЕ ПРОЙДЕНО");
    process.exit(1);
  } else {
    console.log("\nРезультат: ПРОЙДЕНО УСПІШНО");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Критична помилка виконання валідатора:", err);
  process.exit(1);
});
