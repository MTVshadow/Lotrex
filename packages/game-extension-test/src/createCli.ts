#!/usr/bin/env node
import * as path from "node:path";

import minimist from "minimist";

import { scaffoldGameExtension } from "./scaffoldGameExtension";

const args = minimist(process.argv.slice(2).filter((arg) => arg !== "--"));
const required = ["id", "name", "steam-app-id", "nexus-domain", "executable"] as const;
const missing = required.filter((key) => typeof args[key] !== "string" || !args[key].trim());
if (missing.length > 0) {
  console.error(`Missing required options: ${missing.map((key) => `--${key}`).join(", ")}`);
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, "../../..");
const output = scaffoldGameExtension(path.join(repoRoot, "extensions", "games"), {
  executable: args.executable,
  gameId: args.id,
  gameName: args.name,
  nexusDomain: args["nexus-domain"],
  steamAppId: args["steam-app-id"],
});
console.log(`Created ${output}`);
console.log(`Validate with: pnpm game-extension validate game-${args.id}`);
