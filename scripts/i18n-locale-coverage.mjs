import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// CLI options parsing
const args = process.argv.slice(2).filter((arg) => arg !== "--");

function printUsage() {
  console.log("Usage: pnpm run i18n:coverage -- [locale] [options]");
  console.log("Options:");
  console.log("  --strict        Exit with status 1 on missing keys or warnings");
  console.log(
    "  --verbose       Display detailed lists of missing keys, obsolete keys, and warnings",
  );
  console.log(
    "  --check-copies  Check for potential untranslated English copies in non-en locales",
  );
  console.log("  --help, -h      Display this help message");
}

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

const isStrict = args.includes("--strict");
const isVerbose = args.includes("--verbose");
const checkCopies = args.includes("--check-copies") || isStrict;

const locale = args.find((arg) => !arg.startsWith("-")) ?? "uk";
if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale)) {
  console.error(`Error: Invalid locale code: "${locale}". Expected BCP-47 format.`);
  process.exit(1);
}

const root = path.resolve("locales");

// Recursively extract leaf entries
const leafEntries = (value, prefix = "") =>
  Object.entries(value).flatMap(([key, child]) => {
    const fullKey = prefix === "" ? key : `${prefix}.${key}`;
    return child !== null && typeof child === "object" && !Array.isArray(child)
      ? leafEntries(child, fullKey)
      : [[fullKey, child]];
  });

// Extract protected interpolation tokens and React component tags
const extractTokens = (value) =>
  new Set(
    [...String(value).matchAll(/{{\s*([^}\s]+)\s*}}|<\/?([A-Za-z0-9_-]+)>/g)].map(
      (match) => match[1] ?? match[2],
    ),
  );

// Check base key for plural variants (_0, _1, _2, _plural, _one, _other, etc.)
function getBaseKeyForPlural(key) {
  const match = key.match(/^(.*)_(?:0|1|2|plural|one|other|few|many)$/);
  return match ? match[1] : null;
}

// Common untranslatable proper names, technical acronyms, and units
const UNTRANSLATABLE_TERMS = new Set([
  "english",
  "ukrainian",
  "vortex",
  "lotrex",
  "steam",
  "proton",
  "wine",
  "ge-proton",
  "flatpak",
  "snap",
  "heroic",
  "lutris",
  "nexus mods",
  "skyrim",
  "skse",
  "loot",
  "fomod",
  "url",
  "id",
  "json",
  "yaml",
  "vdf",
  "gb",
  "mb",
  "kb",
  "hz",
  "sha-256",
  "ok",
]);

let englishFiles = [];
try {
  englishFiles = (await readdir(path.join(root, "en")))
    .filter((file) => file.endsWith(".json"))
    .sort();
} catch (error) {
  console.error(`Error reading locales/en directory: ${error.message}`);
  process.exit(1);
}

// Check for unknown namespaces in the target locale
let targetFiles = [];
try {
  targetFiles = (await readdir(path.join(root, locale)))
    .filter((file) => file.endsWith(".json") && file !== "meta.json")
    .sort();
} catch (error) {
  if (error.code !== "ENOENT") {
    console.error(`Error reading locales/${locale} directory: ${error.message}`);
    process.exit(1);
  }
}

const unknownNamespaces = targetFiles.filter((file) => !englishFiles.includes(file));

// Validate meta.json if present
const metadataErrors = [];
try {
  const metaContent = await readFile(path.join(root, locale, "meta.json"), "utf8");
  const meta = JSON.parse(metaContent);
  if (meta.code !== locale) {
    metadataErrors.push(`meta.json: field code ("${meta.code}") does not match locale "${locale}"`);
  }
  if (!meta.fallback) {
    metadataErrors.push("meta.json: missing required field fallback");
  }
} catch (error) {
  if (error.code !== "ENOENT") {
    metadataErrors.push(`meta.json: JSON syntax error (${error.message})`);
  }
}

let translatedTotal = 0;
let englishTotal = 0;
const validationErrors = [];
const validationWarnings = [];
const obsoleteKeysFound = [];
const missingKeysFound = [];

console.log(`Locale coverage: ${locale} (fallback: en)`);
console.log("namespace\ttranslated\ttotal\tcoverage");

for (const file of englishFiles) {
  let english = {};
  try {
    english = JSON.parse(await readFile(path.join(root, "en", file), "utf8"));
  } catch (error) {
    validationErrors.push(`${file} (en): JSON syntax error - ${error.message}`);
    continue;
  }

  let translation = {};
  let fileExists = true;
  try {
    translation = JSON.parse(await readFile(path.join(root, locale, file), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      fileExists = false;
    } else {
      validationErrors.push(`${file} (${locale}): JSON syntax error - ${error.message}`);
      continue;
    }
  }

  const englishEntries = new Map(leafEntries(english));
  const translatedEntries = new Map(leafEntries(translation));

  const englishKeys = new Set(englishEntries.keys());
  const translatedKeys = new Set(translatedEntries.keys());

  // Calculate translated count
  let translated = 0;
  for (const key of englishKeys) {
    if (translatedKeys.has(key)) {
      translated++;
    } else {
      // Check for Slavic / target plural expansions
      const hasPluralForms =
        translatedKeys.has(`${key}_0`) ||
        translatedKeys.has(`${key}_1`) ||
        translatedKeys.has(`${key}_2`) ||
        translatedKeys.has(`${key}_plural`);
      if (hasPluralForms) {
        translated++;
      } else if (fileExists && !key.startsWith("_")) {
        missingKeysFound.push(`${file}: ${key}`);
      }
    }
  }

  // Detect obsolete keys in target locale
  for (const key of translatedKeys) {
    if (key.startsWith("_")) continue;
    if (englishKeys.has(key)) continue;

    const baseKey = getBaseKeyForPlural(key);
    if (baseKey && (englishKeys.has(baseKey) || englishKeys.has(`${baseKey}_plural`))) {
      continue; // Legitimate plural form
    }

    obsoleteKeysFound.push(`${file}: ${key}`);
  }

  // Validate translations
  for (const [key, translatedValue] of translatedEntries.entries()) {
    if (key.startsWith("_")) continue;

    if (typeof translatedValue !== "string" || translatedValue.trim() === "") {
      validationErrors.push(`${file}: empty translation at "${key}"`);
      continue;
    }

    let englishValue = englishEntries.get(key);
    let referenceKey = key;
    if (englishValue === undefined) {
      const baseKey = getBaseKeyForPlural(key);
      if (baseKey) {
        englishValue = englishEntries.get(baseKey) ?? englishEntries.get(`${baseKey}_plural`);
        referenceKey = baseKey;
      }
    }

    // Verify interpolation tokens and React tags
    const allowedTokens = new Set([
      ...extractTokens(referenceKey),
      ...(englishValue ? extractTokens(englishValue) : []),
    ]);
    const transTokens = extractTokens(translatedValue);

    for (const token of transTokens) {
      if (!allowedTokens.has(token)) {
        validationErrors.push(
          `${file}: unauthorized or corrupted token "{{${token}}}" at "${key}"`,
        );
      }
    }

    if (englishValue) {
      const engTokens = extractTokens(englishValue);
      for (const token of engTokens) {
        if (!transTokens.has(token)) {
          // 'count' can be omitted in singular forms where substituted by text (e.g. "1 comment")
          if (
            token === "count" &&
            !key.endsWith("_plural") &&
            !key.endsWith("_1") &&
            !key.endsWith("_2")
          ) {
            continue;
          }
          validationErrors.push(`${file}: missing required token "{{${token}}}" at "${key}"`);
        }
      }

      // Check for accidental un-translated copies
      if (locale !== "en" && checkCopies) {
        const engClean = englishValue.trim();
        const transClean = translatedValue.trim();
        if (
          engClean.length > 3 &&
          engClean === transClean &&
          !UNTRANSLATABLE_TERMS.has(engClean.toLowerCase()) &&
          !/^[\d\s.,:/\\_-]+$/.test(engClean)
        ) {
          validationWarnings.push(
            `${file}: possible untranslated English text at "${key}": "${transClean}"`,
          );
        }
      }
    }

    // Check plural completeness for Slavic languages
    if (key.endsWith("_0")) {
      const base = key.slice(0, -2);
      if (!translatedKeys.has(`${base}_1`) || !translatedKeys.has(`${base}_2`)) {
        validationWarnings.push(`${file}: plural form "${key}" missing sibling forms (_0, _1, _2)`);
      }
    }
  }

  englishTotal += englishKeys.size;
  translatedTotal += translated;
  const coverage = englishKeys.size === 0 ? 100 : (translated * 100) / englishKeys.size;
  console.log(
    `${path.basename(file, ".json")}\t${translated}\t${englishKeys.size}\t${coverage.toFixed(1)}%`,
  );
}

const totalCoverage = englishTotal === 0 ? 100 : (translatedTotal * 100) / englishTotal;
console.log(`TOTAL\t${translatedTotal}\t${englishTotal}\t${totalCoverage.toFixed(1)}%`);

// Namespace collisions
if (unknownNamespaces.length > 0) {
  validationErrors.push(
    `Unknown namespaces (not present in locales/en): ${unknownNamespaces.join(", ")}`,
  );
}

// Metadata errors
validationErrors.push(...metadataErrors);

// Issue reporting
if (obsoleteKeysFound.length > 0) {
  if (isStrict) {
    validationErrors.push(`Found ${obsoleteKeysFound.length} obsolete keys`);
  } else {
    validationWarnings.push(`Found ${obsoleteKeysFound.length} obsolete keys`);
  }
}

if (missingKeysFound.length > 0 && isStrict) {
  validationErrors.push(`Missing ${missingKeysFound.length} keys in locale "${locale}"`);
}

if (isVerbose) {
  if (missingKeysFound.length > 0) {
    console.log("\nMissing keys:");
    missingKeysFound.forEach((k) => console.log(`  - ${k}`));
  }
  if (obsoleteKeysFound.length > 0) {
    console.log("\nObsolete keys:");
    obsoleteKeysFound.forEach((k) => console.log(`  - ${k}`));
  }
  if (validationWarnings.length > 0) {
    console.log("\nWarnings:");
    validationWarnings.forEach((w) => console.log(`  - ${w}`));
  }
}

if (validationErrors.length > 0) {
  console.error(`\nValidation failed with ${validationErrors.length} error(s):`);
  validationErrors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
} else {
  const warningsText =
    validationWarnings.length > 0 ? ` (${validationWarnings.length} warning(s))` : "";
  console.log(`Validation: no empty translations, token drifts, or syntax errors${warningsText}`);
  process.exit(0);
}
