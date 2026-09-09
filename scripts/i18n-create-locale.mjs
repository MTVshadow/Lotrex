import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// Validate BCP-47 locale code (e.g., uk, de, pt-BR, zh-CN)
const LOCALE_CODE_REGEX = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

function printUsage() {
  console.log("Usage:   pnpm run i18n:create -- <locale>");
  console.log("Example: pnpm run i18n:create -- de");
  console.log("         pnpm run i18n:create -- pt-BR");
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const locale = args[0];

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (!locale) {
  printUsage();
  process.exit(1);
}

if (!LOCALE_CODE_REGEX.test(locale)) {
  console.error(
    `Error: Invalid locale code: "${locale}". Expected BCP-47 format (e.g. uk, de, pt-BR).`,
  );
  process.exit(1);
}

if (locale === "en") {
  console.error(
    'Error: Cannot scaffold locale "en" as it serves as the canonical source template.',
  );
  process.exit(1);
}

const rootDir = path.resolve("locales");
const englishDir = path.join(rootDir, "en");
const targetDir = path.join(rootDir, locale);

// Guard against destructive overwrite
try {
  const existingFiles = await readdir(targetDir);
  if (existingFiles.length > 0) {
    console.error(
      `Error: Refused destructive overwrite. Directory "${targetDir}" already contains ${existingFiles.length} files.`,
    );
    process.exit(1);
  }
} catch (error) {
  if (error.code !== "ENOENT") {
    console.error(`Error inspecting directory ${targetDir}:`, error.message);
    process.exit(1);
  }
}

await mkdir(targetDir, { recursive: true });

// Read and clone English templates preserving key structure
const englishFiles = (await readdir(englishDir)).filter((file) => file.endsWith(".json")).sort();

let totalNamespaces = 0;

for (const fileName of englishFiles) {
  const sourcePath = path.join(englishDir, fileName);
  const targetPath = path.join(targetDir, fileName);

  const rawContent = await readFile(sourcePath, "utf8");
  const parsed = JSON.parse(rawContent);
  const formatted = JSON.stringify(parsed, null, 2) + "\n";

  await writeFile(targetPath, formatted, "utf8");
  totalNamespaces++;
}

// Generate locale metadata descriptor
const metaPath = path.join(targetDir, "meta.json");
const metaData = {
  code: locale,
  createdAt: new Date().toISOString().split("T")[0],
  fallback: "en",
  status: "draft",
  version: "1.0.0",
};
await writeFile(metaPath, JSON.stringify(metaData, null, 2) + "\n", "utf8");

console.log(`\nSuccessfully scaffolded locale "${locale}":`);
console.log(`  Directory:  ${targetDir}`);
console.log(`  Namespaces: ${totalNamespaces} files copied from canonical template (en)`);
console.log(`  Metadata:   ${metaPath}`);
console.log("\nNext steps for contributors:");
console.log(`  1. Edit JSON files in "${targetDir}" with UTF-8 encoding.`);
console.log(`  2. Validate coverage and token integrity:`);
console.log(`       pnpm run i18n:coverage -- ${locale}`);
console.log(`  3. Preview live in the application:`);
console.log(`       Settings -> Interface -> Language -> ${locale}`);
console.log("  4. Consult TRANSLATING.md for formatting, plurals, and terminology rules.\n");
