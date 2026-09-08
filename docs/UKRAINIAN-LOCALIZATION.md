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

Current structural baseline: all `230 / 230` bundled core English keys are present in Ukrainian
(`100.0%`). Ukrainian plural variants are additional runtime keys and are not counted separately.
The report also rejects empty translations and protected interpolation/component-token mismatches.
This is structural coverage, not proof that every legacy source string has migrated into these
namespaces or that the wording has passed in-app review.

## Translation rules

- Translate values only; preserve JSON keys and interpolation variables such as `{{count}}`.
- Preserve commands, paths, error codes, application IDs, and technical identifiers exactly.
- Add a namespace file incrementally; untranslated keys continue to fall back to English.
- Treat coverage as evidence of presence, then review wording in the running application.
