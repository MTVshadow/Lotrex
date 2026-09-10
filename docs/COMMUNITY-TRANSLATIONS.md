# Community Translation Contribution Guide

This guide outlines how community members, translators, and players can submit corrections, improvements, and reports for Ukrainian (`uk`) localization in Lotrex / Vortex.

---

## 1. Quick In-App Feedback Mechanism

Lotrex includes a lightweight, privacy-safe translation feedback tool built into the application:

1. In the interface, when an issue is spotted (typo, layout clipping, grammatical case error, or terminology inconsistency), open the **Translation Feedback** dialog.
2. Select the issue category:
    - **Typo / Spelling Error** (`typo`)
    - **Grammar / Case Error** (`grammar`)
    - **Terminology Mismatch** (`glossary_mismatch`)
    - **UI Clipping / Layout Overflow** (`clipping_overflow`)
    - **Unclear Context** (`unclear_context`)
    - **Other** (`other`)
3. Enter your proposed Ukrainian correction. The tool runs automated live validation to ensure:
    - Required interpolation variables (e.g. `{{count}}`, `{{name}}`) are preserved.
    - Trans tags (e.g. `<0>...</0>`) remain intact.
    - No non-Ukrainian characters (e.g. `ы`, `э`, `ъ`, `ё`) are inadvertently introduced.
4. Click **"Скопіювати звіт"** (Copy Report) to paste into GitHub/Discord, or **"Відкрити на GitHub"** (Open on GitHub) to immediately generate a pre-filled issue with appropriate labels (`i18n`, `ukrainian`, `translation-feedback`).

---

## 2. Direct Repository Contributions (Pull Requests)

For direct edits or larger translation contributions:

### A. Locate Translation Files

All translation namespaces reside under `locales/`:

- `locales/uk/common.json` — core buttons, actions, shared navigation
- `locales/uk/collection.json` — collection download and management
- `locales/uk/mod_management.json` — mod installation, deployment, conflict resolution
- `locales/uk/download_management.json` — download speeds, threads, queue
- `locales/uk/profile_management.json` — game profiles
- `locales/uk/nexus_integration.json` — Nexus Mods login, API, endorsement
- `locales/uk/gamemode_management.json` — game discovery, activation
- `locales/uk/extension_manager.json` — extension installation and updates
- `locales/uk/health_check.json` — Linux diagnostics, Steam/Proton setup, fixes

### B. Translation Rules

- Always consult [UKRAINIAN-STYLE-GUIDE.md](UKRAINIAN-STYLE-GUIDE.md) for standard terminology:
    - `мод` (not `модифікація` in compact UI)
    - `розгорнути` / `розгортання` (deployment)
    - `папка підготовки модів` (staging folder)
    - `установити` / `установлення` (installation)
    - `відновлення` (recovery)
    - `спосіб виправлення` (remediation)
- Preserve all interpolation placeholders (`{{count}}`, `{{name}}`, `{{path}}`).
- Use Ukrainian apostrophe (`’`, `ʼ`, `'`). Never use Russian letters (`ы`, `э`, `ъ`, `ё`).
- Do not translate product names and trademarks: _Lotrex_, _Vortex_, _Nexus Mods_, _Steam_, _Proton_, _Wine_, _Lutris_, _Heroic_, _Flatpak_, _LOOT_, _SKSE_.

---

## 3. Automated Validation and Verification

Before opening a pull request, run the automated verification suite:

```bash
# 1. Verify 100% structural coverage across all bundled namespaces
pnpm run i18n:coverage -- uk

# 2. Run Ukrainian language correctness suite (Slavic plurals, collation, apostrophes)
pnpm vitest run src/renderer/src/util/localization/ukrainianCorrectness.test.ts

# 3. Run UI and Accessibility QA suite (text expansion, glyph compatibility, 100-200% scaling, a11y)
pnpm vitest run src/renderer/src/util/localization/uiAccessibilityQa.test.ts

# 4. Run translation feedback verification
pnpm vitest run src/renderer/src/util/localization/translationFeedback.test.ts
```

All checks must pass with exit code `0`.
