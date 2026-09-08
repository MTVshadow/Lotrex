import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const locale = process.argv.slice(2).find((argument) => argument !== "--") ?? "uk";
if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale)) {
  throw new Error(`Invalid locale code: ${locale}`);
}
const root = path.resolve("locales");

const leafEntries = (value, prefix = "") =>
  Object.entries(value).flatMap(([key, child]) => {
    const fullKey = prefix === "" ? key : `${prefix}.${key}`;
    return child !== null && typeof child === "object" && !Array.isArray(child)
      ? leafEntries(child, fullKey)
      : [[fullKey, child]];
  });

const protectedTokens = (value) =>
  [
    ...new Set(
      [...String(value).matchAll(/{{\s*([^}\s]+)\s*}}|<\/?([A-Za-z][A-Za-z0-9]*)>/g)].map(
        (match) => match[1] ?? match[2],
      ),
    ),
  ]
    .sort()
    .join(",");

const files = (await readdir(path.join(root, "en")))
  .filter((file) => file.endsWith(".json"))
  .sort();

let translatedTotal = 0;
let englishTotal = 0;
const validationErrors = [];

console.log(`Locale coverage: ${locale} (fallback: en)`);
console.log("namespace\ttranslated\ttotal\tcoverage");

for (const file of files) {
  const english = JSON.parse(await readFile(path.join(root, "en", file), "utf8"));
  let translation = {};
  try {
    translation = JSON.parse(await readFile(path.join(root, locale, file), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const englishEntries = new Map(leafEntries(english));
  const translatedEntries = new Map(leafEntries(translation));
  const englishKeys = new Set(englishEntries.keys());
  const translatedKeys = new Set(translatedEntries.keys());
  const translated = [...englishKeys].filter((key) => translatedKeys.has(key)).length;

  for (const key of englishKeys) {
    if (!translatedEntries.has(key)) continue;
    const translatedValue = translatedEntries.get(key);
    if (typeof translatedValue !== "string" || translatedValue.trim() === "") {
      validationErrors.push(`${file}: empty translation at ${key}`);
    } else if (
      protectedTokens(`${key} ${englishEntries.get(key)}`) !== protectedTokens(translatedValue)
    ) {
      validationErrors.push(`${file}: protected token mismatch at ${key}`);
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

if (validationErrors.length > 0) {
  console.error("\nLocale validation failed:");
  validationErrors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log("Validation: no empty translations or protected-token mismatches");
}
