# Ukrainian localization

Lotrex uses the `uk` locale code and keeps English (`en`) as the explicit fallback. A missing
Ukrainian namespace, key, or bundled-extension translation must therefore display its English value
instead of an empty label or an untranslated key.

The bundled `locales/uk` directory makes Ukrainian discoverable by the existing language picker
while translation proceeds namespace by namespace. It must not be described as complete until the
release criteria in `LINUX-ROADMAP.md` are satisfied.

Russian is not a registered Lotrex UI locale and no Russian translation is bundled. This policy is
limited to the application interface: store metadata and game-specific identifiers such as an
available Russian voice track remain untouched because they describe game content rather than a
Lotrex translation.

## Coverage inventory

Run the deterministic inventory from the repository root:

```sh
pnpm run i18n:coverage -- uk
```

The report compares leaf keys in every bundled English namespace with the matching Ukrainian file.
It reports structural key coverage, not translation quality. A matching key counts as present even
if its wording still needs native-speaker review.

## Namespace inventory

The core runtime currently loads these bundled namespaces:

- `common`
- `collection`
- `mod_management`
- `download_management`
- `profile_management`
- `nexus_integration`
- `gamemode_management`
- `extension_manager`
- `health_check`

Bundled and third-party extensions may own additional locale resources. Those remain a separate
inventory and translation phase because they are discovered dynamically at runtime.

The current source-owned bundled-extension inventory is:

- `src/renderer/src/extensions/collections/language.json`
- `extensions/gamebryo-plugin-management/src/language.json`
- `extensions/mod-dependency-manager/src/language.json`

Files under an extension's `dist` directory are generated mirrors and are not separate translation
sources.

Current structural baseline: all `556 / 556` bundled core English keys are present in Ukrainian
(`100.0%`). Ukrainian plural variants (`_0`, `_1`, `_2`) are additional runtime keys and are verified
in `ukrainianCorrectness.test.ts`. The report validates that no empty translations, token drifts, or
syntax errors exist.

## Native-speaker review and release criteria (Phase 10)

In-situ native-speaker reviews have been conducted across all critical user journeys:

- **First-run & Settings:** Language selection, restart-free live switching, feedback trigger.
- **Linux Setup & Diagnostics:** Steam/Proton discovery, permission checks, remediation commands.
- **Mod Installation & Deployment:** FOMOD installer workflows, install archive modals, conflict resolution.
- **Collections & Downloads:** Slavic plural forms for download and active mod counters.

See [TRANSLATOR-INSTRUCTIONS.md](TRANSLATOR-INSTRUCTIONS.md) for detailed reviewer guidelines and
[COMMUNITY-TRANSLATIONS.md](COMMUNITY-TRANSLATIONS.md) for the community feedback process.

## Known untranslated areas and boundaries

1. **Third-party game extensions:** Extensions that do not bundle Ukrainian translations fall back to English gracefully.
2. **External mod descriptions & FOMOD configs:** Mod descriptions authored by third-party modders remain in their original source language.
3. **Store API metadata:** Live metadata fetched from Nexus Mods or Steam APIs displays store-provided text.
4. **Technical identifiers:** File paths, commands, environment variables, and error codes are protected and never translated.

## Translation rules

- Translate values only; preserve JSON keys and interpolation variables such as `{{count}}`.
- Preserve commands, paths, error codes, application IDs, and technical identifiers exactly.
- Consult [UKRAINIAN-STYLE-GUIDE.md](UKRAINIAN-STYLE-GUIDE.md) for terminology and punctuation rules.
- Add and verify changes using `pnpm run i18n:coverage -- uk` and vitest localization suites.
