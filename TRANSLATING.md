# Lotrex Translation Guide (TRANSLATING.md)

This document describes the localization architecture, workflow, formatting rules, and style requirements for contributing translations to Lotrex.

---

## 1. Architectural Principles

1. **Canonical Template:** The `locales/en/` directory is the single source of truth for keys and structure. Translations must not introduce arbitrary namespaces or keys that do not exist in the canonical English template.
2. **Execution Safety:** Localization files contain display text only. They must not alter application code paths, filesystem permissions, executables, commands, or persistent identifiers.
3. **Protected Content Invariance:** Interpolation variables (`{{variable}}`) and component tags (`<0>...</0>`) are tied to React/runtime logic and must remain intact.

---

## 2. Translator Workflow

### Step 1. Create a Topic Branch

```bash
git checkout -b i18n/<locale-code>
# Example:
git checkout -b i18n/de
```

### Step 2. Scaffold a New Locale

To initialize a new translation, use the built-in scaffolding tool:

```bash
pnpm run i18n:create -- <locale-code>
# Examples:
pnpm run i18n:create -- de
pnpm run i18n:create -- pt-BR
pnpm run i18n:create -- uk
```

This command:

- Validates the BCP-47 locale format;
- Creates the `locales/<locale>/` directory;
- Copies canonical English templates from `locales/en/` while preserving key order and structure;
- Generates `meta.json` with locale metadata;
- Prevents accidental destructive overwrite of existing translation files.

### Step 3. Translate JSON Resources

- Use a code editor with **UTF-8 (without BOM)** encoding.
- Keep standard **2-space indentation**.
- Ensure valid JSON syntax (no trailing commas, properly escaped quotes).
- Translate the values while leaving the JSON keys unchanged.

### Step 4. Validate and Check Coverage

Run the validation and coverage check:

```bash
# Standard check for coverage and token integrity
pnpm run i18n:coverage -- <locale-code>

# Strict check (reports obsolete keys, missing keys, and potential copy issues)
pnpm run i18n:coverage -- <locale-code> --strict --verbose
```

### Step 5. Test Live in the Application

1. Start the application in development mode:
    ```bash
    pnpm start
    ```
2. Navigate to: `Settings` → `Interface` tab → select your language in the `Language` dropdown.
3. Verify that text fits comfortably without clipping at 100%–150% UI scaling, and check that dialogs and notifications format correctly.

---

## 3. Formatting and Syntax Rules

### 3.1. Interpolation Variables

Variables wrapped in double curly braces are passed dynamically at runtime:

```json
// Source (en):
"Cannot write to {{path}}": "Cannot write to {{path}}"

// Correct translation:
"Cannot write to {{path}}": "Не вдалося записати в {{path}}"

// INCORRECT (breaks runtime interpolation):
"Cannot write to {{path}}": "Не вдалося записати в {{шлях}}"
```

### 3.2. React Component Tags

Component tags represent interactive or styled elements (links, bold text, buttons):

```json
// Source (en):
"Visit <1>Nexus Mods</1> to download": "Visit <1>Nexus Mods</1> to download"

// Correct translation:
"Visit <1>Nexus Mods</1> to download": "Відвідайте <1>Nexus Mods</1> для завантаження"
```

---

## 4. Pluralization Rules

Lotrex uses the `i18next` pluralization specification.

### Germanic / English Rules:

- `key`: Singular form (count = 1).
- `key_plural`: Plural form (count = 0, 2+).

### Slavic Rules (Ukrainian, Polish, etc.):

Slavic languages have three plural categories:

- `_0`: Numbers ending in 1 (except 11): 1, 21, 31, 101...
- `_1`: Numbers ending in 2, 3, 4 (except 12, 13, 14): 2, 3, 4, 22, 23...
- `_2`: Numbers ending in 5–9, 0, and 11–14: 5, 6, 11, 20, 25...
- `_plural`: General fallback plural form.

**Example from `common.json`:**

```json
"{{ count }} active mod_0": "{{ count }} активний мод",
"{{ count }} active mod_1": "{{ count }} активні моди",
"{{ count }} active mod_2": "{{ count }} активних модів",
"{{ count }} active mod_plural": "{{ count }} активних модів"
```

---

## 5. Terminology and Style Guide

To maintain consistency and technical accuracy, adhere to the standard project terminology:

| English Term          | Ukrainian Equivalent           | Notes and Context                                   |
| :-------------------- | :----------------------------- | :-------------------------------------------------- |
| **Deployment**        | Розгортання                    | Linking or moving mod files into the game directory |
| **Deploy**            | Розгорнути                     | Action to apply mods                                |
| **Purge**             | Очистити (розгорнуті файли)    | Removing deployed links from the game folder        |
| **Staging directory** | Каталог підготовки (staging)   | Directory storing extracted mod files               |
| **Hardlink**          | Жорстке посилання (hardlink)   | Recommended fast method on the same filesystem      |
| **Symlink**           | Символьне посилання (symlink)  | Link across filesystems                             |
| **Mod**               | Мод                            | Standard gaming term                                |
| **Collection**        | Колекція                       | Curated mod collection                              |
| **Health Check**      | Перевірка працездатності       | Diagnostics and system verification                 |
| **Elevation / Root**  | Підвищення привілеїв           | Superuser / root privileges                         |
| **Runtime**           | Середовище виконання / Рантайм | Proton / Wine runtime                               |
| **Prefix**            | Префікс                        | Wine/Proton prefix (`compatdata/<appid>/pfx`)       |

### Proper Names to Keep Untranslated:

- **Lotrex**, **Vortex**, **Nexus Mods**
- **Steam**, **Proton**, **GE-Proton**, **Wine**
- **Heroic Games Launcher**, **Lutris**
- **Flatpak**, **Snap**, **AppImage**
- Game and tool names: **Skyrim Special Edition**, **SKSE**, **LOOT**, **xEdit**, **Creation Kit**

---

## 6. Safety Copy

Notifications concerning potential data loss, file deletion, or filesystem conflicts must remain calm, precise, and unambiguous:

- Clearly state the target affected (game folder, prefix, backup);
- Avoid alarming or emotional phrasing;
- Provide clear instructions on how to safely recover, rollback, or cancel.

---

## 7. Submitting Changes (Pull Request)

1. Verify that `pnpm run i18n:coverage -- <locale>` completes with 100% coverage and zero token errors.
2. Format your commit message following Conventional Commits:
    ```bash
    git commit -m "feat(i18n): update <locale> translations"
    ```
3. All translations are licensed under the project's **GPL-3.0** license. Authorship is acknowledged in `meta.json` and repository release notes.
