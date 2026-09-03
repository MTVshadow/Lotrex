# Linux Support Roadmap

This document tracks potential improvements required to make the Linux build of Vortex reliable
for regular use, initially focusing on Skyrim Special Edition running through Steam Proton.

## Current status

- The `linux-all` branch builds and packages successfully on Arch Linux.
- Steam discovery finds Skyrim Special Edition (App ID `489830`).
- Hardlink deployment initializes successfully.
- LOOT masterlist updates work.
- Skyrim's `Documents/My Games` and `AppData/Local` paths can be resolved inside its Proton prefix.
- A clean first launch no longer fails when the Vortex configuration directory does not exist.
- Full end-to-end mod installation, deployment, launch, and purge still need verification.

## P0 — Required for daily use

### 1. Centralize Proton path resolution

Create a shared `ProtonPaths` service instead of resolving prefixes independently in extensions.
It should expose at least:

- Wine prefix root;
- Windows user profile;
- `Documents` and `Documents/My Games`;
- `AppData/Roaming` and `AppData/Local`;
- game installation directory;
- Steam and Proton runtime locations.

Consumers to migrate include local game settings, INI preparation, plugin management, save-game
management, archive invalidation, script-extender log detection, and the open-directory extension.

Completion criteria:

- no Skyrim component uses native Linux user directories for Windows game data;
- every consumer uses one tested resolver;
- resolution failures produce actionable diagnostics and retain a safe fallback.

### 2. Make Proton detection robust

- Prefer a discovered Steam App ID instead of repeatedly scanning manifests.
- Support additional and external Steam libraries.
- Support native and Flatpak Steam layouts.
- Handle Proton-GE and custom compatibility tools.
- Do not assume that the Wine user is always named `steamuser`.
- Allow a manual prefix override.
- Cache successful results and invalidate them after game rediscovery or library changes.
- Escape or avoid regular expressions when matching Steam manifest values.

Completion criteria:

- Skyrim is resolved correctly in the default, external-library, and Flatpak layouts;
- an early lookup before discovery completes does not permanently cache failure;
- moving the game or changing its library refreshes all derived paths.

### 3. Persist Nexus authentication

Investigate why Nexus authentication may not survive a repackaged build or restart:

- Linux keyring integration through `libsecret`;
- Electron `safeStorage` availability and selected backend;
- stable application identity and `userData` location;
- compatibility between development and packaged builds;
- behavior when an existing secret cannot be decrypted.

Completion criteria:

- login survives normal restarts and application updates;
- failures are reported clearly without silently discarding credentials;
- the behavior is tested with and without an available desktop keyring.

### 4. Complete the Skyrim mod lifecycle test

Test the following workflow with a small asset-only mod and then a mod containing an ESP/ESL:

1. Download from Nexus.
2. Install and enable.
3. Deploy into Skyrim's `Data` directory.
4. Import and update `plugins.txt`.
5. Sort with LOOT.
6. Launch Skyrim through Proton.
7. Confirm the mod is active in game.
8. Purge and verify that vanilla files are restored.

Completion criteria:

- both mod types complete the workflow without manual file copying;
- deployment and purge leave no unexpected files;
- the plugin state remains consistent between Vortex and the Proton prefix.

## P1 — Compatibility and reliability

### 5. Launch games and modding tools through Proton

Support correct launch environments for:

- `SkyrimSE.exe`;
- `skse64_loader.exe`;
- LOOT;
- xEdit;
- BodySlide;
- Nemesis or Pandora;
- Creation Kit.

Provide the correct working directory, `STEAM_COMPAT_DATA_PATH`,
`STEAM_COMPAT_CLIENT_INSTALL_PATH`, and selected Proton runtime. Let users select or override the
compatibility tool when automatic detection is insufficient.

### 6. Harden deployment

- Detect whether staging and the game are on the same filesystem before selecting hardlinks.
- Provide a clear fallback to symlink or copy deployment.
- Make deploy and purge operations recoverable after interruption.
- Verify external changes and Steam file validation behavior.
- Handle permissions and sandbox boundaries for Flatpak Steam.
- Avoid modifying timestamps or game archives unless the selected deployment feature requires it.

### 7. Handle case-sensitive filesystems

- Resolve game paths case-insensitively where Windows would do so.
- Detect files and directories that differ only by case.
- Normalize Windows and POSIX separators at archive and deployment boundaries.
- Reject unsafe absolute paths and traversal from mod archives.
- Cover Unicode and locale-specific filenames.

Completion criteria:

- common older Skyrim mods install correctly on a case-sensitive filesystem;
- ambiguous case collisions produce a clear user-facing conflict instead of silent overwrite.

### 8. Cover all Windows data locations

Audit extensions for direct usage of native Linux equivalents of Windows paths, particularly:

- save games;
- SKSE and tool logs;
- INI files and INI tweaks;
- plugin lists and load order;
- archive invalidation settings;
- tool configuration and output directories.

Replace direct `getVortexPath("documents")`, `LOCALAPPDATA`, and inferred `~/Local` usage when the
target is a Windows game running in Proton.

## P2 — Distribution and user experience

### 9. Finish Flatpak packaging

- Maintain a reproducible Flatpak manifest.
- Support native and Flatpak Steam libraries, including external disks.
- Use portals for file and directory selection where appropriate.
- Document or automate required filesystem overrides.
- Ensure `xdg-open`, Nexus protocol links, keyring access, and self-updates behave correctly.

### 10. Add Linux-specific onboarding and diagnostics

On first launch:

- discover Steam installations, libraries, games, and prefixes;
- verify that Skyrim has been run once and its INI files exist;
- recommend a safe staging directory and explain hardlink filesystem requirements;
- check keyring and sandbox access;
- show resolved Proton, prefix, Documents, AppData, staging, and deployment paths;
- provide a copyable diagnostic report.

### 11. Silence unsupported Windows-only extensions

Do not initialize Windows-only discovery paths on Linux when they require the registry, Windows
Store APIs, or unavailable native modules. Treat expected platform incompatibility as
`unsupported`, not as an error.

Completion criteria:

- startup logs prominently show actionable Linux problems;
- expected Windows-only exclusions do not flood the log with stack traces.

## Automated testing plan

Create a synthetic Steam library and Proton prefix fixture containing manifests, INI files,
`plugins.txt`, and a minimal game directory. Test:

- Steam game and App ID discovery;
- prefix, Documents, and AppData resolution;
- discovery becoming available after an earlier failed lookup;
- standard, external, and Flatpak library layouts;
- plugin import and writeback;
- asset-only and plugin mod deployment;
- deploy/purge recovery;
- case-only filename conflicts;
- Windows executable launch command construction;
- clean first launch without an existing Vortex configuration directory;
- authentication persistence with available and unavailable keyrings.

Keep unit tests for path resolution independent of a real Steam installation. Reserve tests that
launch Proton or modify a real game installation for an explicitly enabled integration suite.

## Suggested implementation order

1. Shared `ProtonPaths` service and migration of Skyrim consumers.
2. Nexus authentication persistence.
3. Asset-only mod deploy/purge test.
4. ESP/ESL plugin and LOOT test.
5. Skyrim and SKSE launch support.
6. Case-sensitive filesystem handling.
7. Flatpak packaging and onboarding.
8. Broader game compatibility.

## Known non-blocking observations

- A missing `SkyrimCustom.ini` is normal because that file is optional.
- A missing `skse64_loader.exe` is expected until SKSE is installed.
- Fontconfig and Mesa warnings observed in the development environment should be retested outside
  the development sandbox before being classified as application defects.
