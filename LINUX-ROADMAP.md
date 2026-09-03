# Linux Support Roadmap

This document tracks potential improvements required to make the Linux build of Vortex reliable
for regular use, initially focusing on Skyrim Special Edition running through Steam Proton.

## Current status

- The `linux-all` branch builds and packages successfully on Arch Linux.
- Steam discovery finds Skyrim Special Edition (App ID `489830`).
- Hardlink deployment initializes successfully.
- LOOT masterlist updates work.
- Centralized `ProtonPaths` service implemented and fully tested.
- All 7 consumers migrated from direct Linux paths to `ProtonPaths` (local game settings, INI preparation, plugin management, save-game management, archive invalidation, script extender logs, open-directory).
- Robust Proton prefix detection: manifest parsing without regex, multi-library & Flatpak/Snap layouts, dynamic Wine user resolution, case-insensitive directory lookups, caching & invalidation.
- Stable application identity (`app.name = "Vortex"`) set to guarantee consistent `userData` location (`~/.config/Vortex`) across dev and packaged releases.
- Proton tool launcher upgraded: external mod tools (LOOT, xEdit, BodySlide, Nemesis, Pandora) and SKSE automatically launched inside the game's Proton prefix; multi-location GE-Proton/UMU-Proton detection and semver scoring implemented; `STEAM_COMPAT_TOOL_PATHS` and `STEAM_COMPAT_MOUNTS` configured.
- Mod archive extraction & installer normalized: directory markers with forward/backslashes handled, destination paths normalized to prevent backslash file naming on Linux filesystems.
- Case-folding directory collision resolved in `LinkingDeployment.ts`: resolves existing target directory case before linking, preventing duplicate capitalized folders (`Data/Textures` vs `Data/textures`).
- NXM protocol integration fixed and tested on Linux desktop: direct URL extraction in CLI, FreeDesktop MIME registration via `xdg-mime`, and proper Electron app path resolution in desktop entry scripts.
- Verified Skyrim Special Edition mod lifecycle under Proton: SKSE execution, SkyUI inventory management, and Ukrainian localization strings functioning with `bInvalidateOlderFiles=1`.
- A clean first launch no longer fails when the Vortex configuration directory does not exist.
- Typed game platform and deployment capabilities implemented (`IGameCapabilities`, `resolveGameSteamAppId`, `gamePlatformCapabilities`).
- Game extension validation engine and CLI implemented (`pnpm run game-extension run validate <game>`) with contract verification and platform capability validation.
- Linux filesystem assessment service (`linuxMounts.ts`): `/proc/mounts` parsing, detection of `ro`, `noexec`, cross-device hardlink barriers, and NTFS/exFAT Proton prefix warnings.
- Structured filesystem error translation (`filesystemErrors.ts`): user-friendly actionable remediation for `EXDEV`, `EROFS`, `EACCES`, `ENOSPC`.
- Case-sensitivity collision diagnostics (`caseCollisions.ts`): pre-deployment detection of case conflicts across mod files on Linux filesystems.
- Privacy-safe diagnostic report exporter (`diagnosticReport.ts`): automated redaction of usernames, home paths, and secrets for troubleshooting.
- Linux-aware Open Directory actions extended: direct shortcuts to Proton prefix folder and Vortex logs with actionable error notifications.
- Linux staging path suggestion (`suggestStagingPath.ts`) ensuring staging and game reside on the same filesystem partition for hardlinks.
- Heroic Games Launcher (Epic & GOG) and Lutris store discovery integrated on Linux.
- Flatpak Steam detection and minimal permission remediation (`flatpakSupport.ts`): directory access validation and scoped `flatpak override` generation without broad filesystem access.
- Unified Linux Launch Provider (`unifiedLaunchProvider.ts`): centralized orchestration for native Linux binaries, Steam Proton, Heroic URI, and Lutris URI launches with environment configuration.
- Proton runtime discovery and validation service (`protonRuntimes.ts`): dynamic detection of Proton, Experimental, GE-Proton, and custom runner directories with executable script checks.
- Platform-aware remediation provider (`platformRemediation.ts`): automatic filtering of Windows-specific terminology (run as administrator, registry, drive letters, defender) into Linux POSIX guidance.

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

### 12. Integrated In-App Mod Browser for Nexus Mods

Enhance the existing `browse_nexus` extension by replacing the "Coming Soon" placeholder in the
`Mods` tab with an integrated mod browser.

Architecture candidates:

- **Option A (Embedded Webview Browser):**
    - Embed `https://www.nexusmods.com/{game}/mods` via Electron `<webview>` (`WebviewEmbed`).
    - Add standard browser navigation controls (back, forward, reload, home, URL/search input).
    - Intercept in-page `nxm://` ("Mod Manager Download") triggers directly via Electron
      `will-navigate` / webContents listeners, starting downloads seamlessly inside Vortex without
      opening external browser windows.
- **Option B (Native GraphQL/REST Mod Catalog):**
    - Query Nexus Mods API / GraphQL for game mods (`trending`, `latest`, `most endorsed`).
    - Render native React mod tiles with cover art, description, endorsement counts, and direct
      1-click install button.
    - Implement full-text search and category filtering matching the Collections tab styling.

Completion criteria:

- users can search, browse, and initiate mod downloads directly inside the Vortex window;
- no external browser window is required for regular browsing and 1-click downloads;
- memory and process lifecycle of the embedded view are properly managed upon tab switching.

## Linux daily-usability direction

The following workstreams expand the earlier Skyrim-focused milestones into a general Linux user
experience. They should be implemented as reusable platform services rather than per-game fixes.
The existing `ProtonPaths`, typed game capabilities, Linux health-check infrastructure, and
Heroic/Lutris discovery are foundations for this work, not substitutes for the completion criteria
below.

### Highest priority

#### 13. Linux Environment Health Check

Add a comprehensive pre-deployment assessment that checks:

- write access to the game and staging directories;
- whether staging and the game share a filesystem and therefore support hardlink deployment;
- whether symlinks can be created and used at the destination;
- available disk space;
- native, Flatpak, and Snap Steam installations;
- access to external disks, including sandbox restrictions;
- the selected Proton prefix and runtime;
- NTFS/exFAT filesystem type and relevant mount options.

The result must identify problems before install or deployment begins, distinguish blocking issues
from recommendations, and provide an actionable remediation for every failure.

#### 14. First-class Flatpak Steam support

Automatically discover and support:

- `~/.var/app/com.valvesoftware.Steam/data/Steam`;
- libraries configured by Flatpak Steam;
- `compatdata` prefixes;
- bundled, Experimental, GE-Proton, and custom Proton runtimes;
- external disks made available through portals or Flatpak filesystem permissions.

When access is missing, show the exact directory and a narrowly scoped Flatseal or
`flatpak override` recommendation. Do not suggest broad filesystem access when a smaller permission
is sufficient, and do not show Flatpak-specific advice for native Steam installations.

#### 15. Linux first-run wizard

Provide a short onboarding flow that displays:

- the detected Steam installation type;
- discovered libraries;
- the recommended staging path;
- the recommended deployment method;
- Proton prefix and runtime status;
- a **Check configuration** action;
- a concise hardlink-versus-symlink explanation.

The wizard should be safe to rerun from Settings and should reuse the same diagnostics and
recommendation services used during deployment.

#### 16. Automatic deployment-method selection

Replace static priority-only selection on Linux with capability- and filesystem-aware selection:

- use hardlinks when staging and the game share `st_dev` and the destination supports them;
- use symlinks when the paths are on different filesystems and symlinks are supported;
- offer move deployment only when the game explicitly declares support;
- explain why a method was selected or rejected;
- warn before changing the active method;
- migrate staging safely, with rollback or recovery after interruption.

### Launching and Proton

#### 17. Unified Linux Launch Provider

Consolidate launch decisions currently spread across Steam, `StarterInfo`, game extensions, and
Proton helpers into one service:

```text
Game or tool
  -> native executable, launcher URI, or Windows executable
  -> environment, prefix, and runtime
  -> structured launch result and diagnostics
```

The provider must support:

- Steam URI launches;
- an explicitly selected Proton version;
- Proton Experimental and GE-Proton;
- Flatpak Steam;
- launcher and game launch options;
- `STEAM_COMPAT_DATA_PATH` and related compatibility variables;
- opt-in Wine/Proton logs with safe paths;
- native Linux executables when available;
- Heroic and Lutris launch contexts.

#### 18. Per-game Proton runtime UI

Allow users to choose:

- Automatic;
- Steam-selected;
- Proton Experimental;
- GE-Proton;
- a manually selected runtime path.

Show whether the selected runtime is installed and usable, its source, and an action to open its
directory. Invalid manual overrides must produce an actionable validation error.

#### 19. Safe Windows modding-tool launch

LOOT, xEdit, Nemesis, FNIS, BodySlide, and similar tools should automatically use the same prefix,
Steam App ID, runtime, and relevant environment as the managed game. This must also work for games
discovered through Heroic and Lutris when their launch context is available.

If an identical environment cannot be constructed, show which component is missing instead of a
generic process error. Never silently launch a Windows tool as a native executable on Linux.

### Filesystem compatibility

#### 20. Case-sensitivity diagnostics

Before deployment:

- detect paths that differ only by case, such as `Textures/foo.dds` and `textures/Foo.dds`;
- identify the involved mods and files;
- show a blocking conflict when deployment would be ambiguous or destructive;
- optionally offer deterministic normalization where it is safe and reversible.

This should operate on the deployment plan so conflicts can be reported before files are written.

#### 21. NTFS/exFAT mount-option assessment

Detect and explain:

- read-only mounts;
- `noexec` where executable access is required;
- incompatible `uid`/`gid` ownership;
- unstable or unsuitable inode behavior;
- unavailable or emulated symlink support;
- Proton prefixes placed on filesystems that cannot reliably represent their structure.

Vortex must not remount disks or edit `/etc/fstab`. It may provide a copyable, filesystem-specific
example after clearly identifying the affected mount and warning the user to verify device IDs and
ownership values.

#### 22. Actionable `EXDEV`, `EACCES`, and `EROFS` handling

Translate common filesystem failures into structured errors containing:

- a human-readable problem name;
- source and destination paths;
- the active deployment method;
- an action that opens staging settings;
- a compatible fallback method when one is available;
- a retry action after the underlying issue is corrected.

Preserve the original error code and operation in diagnostic logs.

### Daily Linux UX

#### 23. Linux-aware **Open directory** actions

Provide quick access to:

- the game directory;
- staging and downloads;
- the Proton/Wine prefix and `drive_c`;
- the Steam library;
- Vortex logs.

Use XDG portals when required and support Wayland, sandboxed packages, and common file managers.
Opening a missing or inaccessible path should produce an actionable message rather than silently
failing.

#### 24. Privacy-safe diagnostic report export

Generate a single copyable or exportable report containing:

- distribution and kernel;
- Wayland/X11 session type;
- Steam installation type;
- libraries, mounts, and filesystem types;
- deployment method;
- selected Proton runtime and prefix status;
- relevant access checks;
- recent related errors.

Automatically redact tokens, API keys, user names, home-directory components, and other sensitive
paths. Include a preview so the user can inspect the exact report before sharing it.

#### 25. Platform-aware notifications and remediation

Route advice through platform-specific resolution providers. Linux users must not receive
instructions involving:

- **Run as Administrator**;
- the Windows registry;
- drive-letter terminology;
- Windows Defender exclusions.

Shared errors should keep a common identity while their explanation, actions, and help links are
resolved for the active platform and packaging format.

### Game-extension architecture

#### 26. Typed game capabilities

Continue replacing implicit `details: any` conventions with a versioned, validated contract, for
example:

```ts
platforms: {
  linux?: {
    launch: "native" | "steam-proton" | "wine";
    steamAppId?: string;
    supportsToolsInPrefix?: boolean;
  };
};

deployment: {
  hardlink?: boolean;
  symlink?: boolean;
  move?: boolean;
};
```

Capabilities must be available to discovery, deployment, launch, health checks, and extension
validation. Maintain compatibility adapters for existing extensions while logging deprecated
implicit fields during development.

#### 27. Game-extension validation CLI

Add a command such as:

```sh
pnpm game-extension validate game-skyrimse
```

It should validate:

- the `IGame` contract;
- discovery results and store IDs;
- executable definitions for every declared platform;
- mod and data paths;
- installer fixtures;
- Linux capabilities;
- accidental absolute Windows-only paths;
- registered health-check providers.

The command must be deterministic, suitable for CI, and produce both human-readable and optional
machine-readable output.

#### 28. New-game extension template

Provide a generator containing:

- a minimal typed `IGame` implementation;
- Steam discovery and optional Heroic/Lutris identifiers;
- Linux and Windows executable declarations;
- an installer skeleton;
- diagnostics providers;
- fixtures and contract tests;
- short extension documentation.

Generated extensions should pass validation and type checking without modification. Platform-
specific functionality should be explicit, so adding a game does not require copying hidden
conventions or Windows-only assumptions.

### Delivery sequence for the expanded direction

1. Complete the environment assessment and Flatpak Steam discovery foundations.
2. Reuse those services in first-run onboarding and automatic deployment selection.
3. Introduce the unified launch provider and runtime-selection UI.
4. Route Windows modding tools, Heroic, and Lutris through the unified launch context.
5. Add case-collision, mount-option, and structured filesystem-error diagnostics.
6. Add Linux-aware directory actions, diagnostic export, and platform-specific remediation.
7. Stabilize the typed capability contract, then ship the validation CLI and extension template.

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
