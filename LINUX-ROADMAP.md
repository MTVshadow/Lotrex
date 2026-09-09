# Linux Support Roadmap

This roadmap tracks evidence, not estimated completion. A check in one column does not imply a
check in the columns to its right.

| State                 | Meaning                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Implemented**       | The code or fixture exists.                                                                                          |
| **Integrated**        | A production call path uses it.                                                                                      |
| **Manually verified** | The current behavior was exercised in a real packaged or desktop environment.                                        |
| **Automated**         | A deterministic automated test covers the behavior.                                                                  |
| **Blocked**           | The remaining verification needs external state, credentials, hardware, packaging, or a deliberate product decision. |
| **Deferred**          | Verification is intentionally postponed and is not part of the current delivery gate.                                |

## Current delivery gate

|   # | Workstream                                       | Implemented | Integrated | Manually verified | Automated | Blocked | Evidence / next gate                                                                                                                                                                                                                                      |
| --: | ------------------------------------------------ | :---------: | :--------: | :---------------: | :-------: | :-----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Central Proton path resolution                   |     ✅      |     ✅     |        ✅         |    ✅     |    —    | `ProtonPaths` is used by game settings, INI, plugins, saves, archive invalidation, logs, and directory actions.                                                                                                                                           |
|   2 | Unified Linux launch provider                    |     ✅      |     ✅     |         —         |    ✅     |    —    | `StarterInfo` routes native binaries, Steam/Proton, Heroic, Lutris, games, and tools through one launch plan. Runtime selection is no longer duplicated in `Steam.ts`.                                                                                    |
|   3 | Linux environment assessment                     |     ✅      |     ✅     |         —         |    ✅     |    —    | Mount options, filesystem type, hardlink compatibility, permissions, deployment paths, prefix paths, and Flatpak access feed Health Check and the pre-deployment gate.                                                                                    |
|   4 | Deployment-plan case collision checks            |     ✅      |     ✅     |         —         |    ✅     |    —    | The real linking plan is rejected before its first write when case-only paths are ambiguous.                                                                                                                                                              |
|   5 | Structured filesystem deployment errors          |     ✅      |     ✅     |         —         |    ✅     |    —    | Link/unlink failures are translated with code, method, source, destination, and remediation while preserving the original diagnostic error.                                                                                                               |
|   6 | Flatpak app ID, escaping, and scoped permissions |     ✅      |     ✅     |         —         |    ✅     |    —    | The running Vortex Flatpak ID takes precedence; app IDs and paths are shell-quoted; overrides remain directory-scoped.                                                                                                                                    |
|   7 | Diagnostic redaction and Linux localization      |     ✅      |     ✅     |         —         |    ✅     |    —    | Tokens, generic key/value secrets, usernames, home paths, mount options, and issue messages are redacted; user-visible Linux diagnostics use localization keys.                                                                                           |
|   8 | Nexus authentication persistence                 |     ✅      |     ✅     |         —         |    ✅     |   ⚠️    | The confidential hive uses Electron `safeStorage`, reads legacy plaintext, and has an explicit no-keyring fallback/error path. A packaged restart/update with a real desktop keyring still needs manual verification.                                     |
|   9 | Synthetic asset + ESP deployment lifecycle       |     ✅      |     ✅     |         —         |    ✅     |    —    | A headed Electron/Playwright run installs an offline Skyrim archive, exercises the production hardlink activator, verifies the ESP and asset, purges them, and confirms vanilla backup restoration.                                                       |
|  10 | Real Nexus → LOOT → Proton → in-game lifecycle   |      —      |     —      |        ✅         |     —     |   ⚠️    | Previous local Skyrim/SKSE/SkyUI use was manually verified, but a repeatable full test requires Nexus credentials, Steam/Proton, LOOT data, and an explicitly enabled external integration environment.                                                   |
|  11 | Linux first-run setup assistant                  |     ✅      |     ✅     |         —         |    ✅     |    —    | The first managed Linux game raises a persistent setup entry point. The rerunnable Mods settings panel shows Steam type/roots, staging, method recommendation, prefix/runtime, and configuration checks; its platform/runtime/problem model is automated. |
|  12 | Filesystem-aware deployment selection            |     ✅      |     ✅     |         —         |    ✅     |    —    | Linux prefers an eligible hardlink method, falls back to symlink, honors game capability exclusions, and never selects move unless the game opts in.                                                                                                      |
|  13 | Per-game Proton runtime UI                       |     ✅      |     ✅     |         —         |    ✅     |    —    | Automatic, Steam-selected, Experimental, GE-Proton, and custom paths persist per game and feed the unified launch plan; missing overrides return actionable validation errors.                                                                            |

## Compatibility and reliability backlog

| Workstream                                                  | Implemented | Integrated | Manually verified | Automated | Blocked | Remaining acceptance work                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | :---------: | :--------: | :---------------: | :-------: | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steam discovery: native, external libraries, Flatpak, Snap  |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Keep fixtures aligned with Steam VDF changes.                                                                                                                                                                                                                          |
| Proton prefix/user/runtime discovery and cache invalidation |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Add packaged Flatpak and Snap smoke runs.                                                                                                                                                                                                                              |
| Windows modding tools in the game prefix                    |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Manually repeat xEdit, BodySlide, Nemesis/Pandora, and Creation Kit with the unified provider.                                                                                                                                                                         |
| Case-insensitive Windows data paths                         |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Extend fixtures with Unicode and locale-sensitive names.                                                                                                                                                                                                               |
| Safe archive separator/path normalization                   |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Add more Unicode and malformed-archive corpus cases.                                                                                                                                                                                                                   |
| Interrupted deployment recovery                             |      —      |     —      |         —         |     —     |   ⚠️    | Requires a transaction/rollback design covering process death between backup, link, manifest write, and purge.                                                                                                                                                         |
| External changes and Steam validation behavior              |     ✅      |     ✅     |         —         |    ✅     |    —    | Add a Linux hardlink-specific manual matrix.                                                                                                                                                                                                                           |
| NTFS/exFAT ownership and inode reliability                  |     ✅      |     ✅     |         —         |    ✅     |   ⚠️    | Detection exists; representative real mounts are required for manual validation. Vortex must not remount or edit `fstab`.                                                                                                                                              |
| Available disk-space preflight                              |     ✅      |     ✅     |         —         |    ✅     |    —    | Cross-filesystem move deployment estimates active mod/merge data and enforces destination capacity plus a safety reserve; packaged filesystem smoke remains.                                                                                                           |
| Symlink capability probe                                    |     ✅      |     ✅     |         —         |    ✅     |    —    | A reversible destination probe blocks an incompatible selected method and feeds Health Check; packaged filesystem smoke tests remain.                                                                                                                                  |
| Heroic and Lutris library discovery                         |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Heroic native manifests parse installed Epic/GOG entries. Lutris checks native/Flatpak XDG data and config roots with in-process read-only `pga.db` SQLite reader for full identity, runner, directory, and configpath reconciliation without filename slug inferring. |

Launcher desktop verification note: a running native Heroic client exposed two readable manifests;
all seven installed entries parsed without errors, and one optional per-game override was applied.
The initial Lutris check exposed that its current native YAML files live under
`$XDG_DATA_HOME/lutris/games`, not only the legacy config root. After adding native and Flatpak data
roots, all seven YAML files are discovered without parse errors, but only one was self-contained.
The other six entries are now resolved through an in-process, read-only `pga.db` reader that matches
`configpath`, `service_id`, or explicit YAML slug without filename inferring. Tested against modern
and legacy SQLite schemas, Flatpak paths, and migration fallbacks. No launcher or game was invoked.

## Distribution and daily Linux UX backlog

| Workstream                                         | Implemented | Integrated | Manually verified | Automated | Blocked | Remaining acceptance work                                                                                                                                                                                                                                           |
| -------------------------------------------------- | :---------: | :--------: | :---------------: | :-------: | :-----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stable application identity and clean first launch |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Retest every packaged channel.                                                                                                                                                                                                                                      |
| NXM desktop protocol registration                  |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Add Flatpak portal packaging verification.                                                                                                                                                                                                                          |
| Linux-aware Open Directory actions                 |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Verify common Wayland portals and file managers in packaged builds.                                                                                                                                                                                                 |
| Privacy-safe diagnostic report export              |     ✅      |     ✅     |         —         |    ✅     |    —    | Linux Health Check exposes the exact redacted Markdown preview and can copy or atomically save that same content. Packaged save-dialog smoke remains.                                                                                                               |
| Platform-aware remediation                         |     ✅      |     ✅     |         —         |    ✅     |    —    | Continue converting legacy shared notifications that contain Windows-only guidance.                                                                                                                                                                                 |
| Silence unsupported Windows-only extensions        |     ✅      |     ✅     |         —         |    ✅     |    —    | Elevated symlink, GeDoSaTo, Xbox, Origin, Windows GOG, and Ubisoft stores exit before non-Windows registration and avoid native binding loads. FOMOD keeps its cross-platform installer but Windows-gates AppContainer. Platform gates have deterministic coverage. |
| Reproducible Flatpak package and portals           |      —      |     —      |         —         |     —     |   ⚠️    | Needs a maintained manifest, portal policy, keyring access, update policy, and packaged smoke environment.                                                                                                                                                          |
| Integrated Nexus mod browser                       |      —      |     —      |         —         |     —     |   ⚠️    | Requires a product/security decision between an embedded webview and a native API catalog.                                                                                                                                                                          |

## Game-extension architecture backlog

| Workstream                                 | Implemented | Integrated | Manually verified | Automated | Blocked | Remaining acceptance work                                                                                                                                                                                  |
| ------------------------------------------ | :---------: | :--------: | :---------------: | :-------: | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed platform and deployment capabilities |     ✅      |     ✅     |         —         |    ✅     |    —    | Continue migrating legacy `details` conventions.                                                                                                                                                           |
| Game-extension validation CLI              |     ✅      |     ✅     |         —         |    ✅     |    —    | Add more Linux installer and health-provider contract checks.                                                                                                                                              |
| New-game extension template                |     ✅      |     ✅     |         —         |    ✅     |    —    | `@vortex/game-extension-test` provides an atomic, non-overwriting create command for typed Steam/Proton discovery, capabilities, installer, diagnostics, fixture descriptor, build, validation, and tests. |

## Required automated matrix

| Scenario                                                                    |  Unit   | Integration |                       External/manual                       |
| --------------------------------------------------------------------------- | :-----: | :---------: | :---------------------------------------------------------: |
| Default, external, Flatpak, and Snap Steam paths                            |   ✅    |     ✅      |                   Pending packaged smoke                    |
| Prefix, Documents, My Games, and AppData                                    |   ✅    |     ✅      |              Previously verified for Skyrim SE              |
| Runtime selection and Windows launch plan                                   |   ✅    |     ✅      |              Pending packaged UI/launch smoke               |
| Environment assessment and pre-deployment blocking                          |   ✅    |     ✅      |                Pending representative mounts                |
| Asset and ESP deploy/undeploy with backup restoration                       |   ✅    |     ✅      | Automated headed desktop pass; real-game manual run pending |
| Case-only collision before writes                                           |   ✅    |     ✅      |                      Pending UI smoke                       |
| Authentication with and without keyring                                     |   ✅    |     ✅      |         Blocked on packaged desktop/keyring matrix          |
| Nexus download, plugin writeback, LOOT, Proton launch, in-game confirmation | Partial |      —      |   Blocked on explicitly enabled external test environment   |

## Readiness snapshot

This is a planning estimate derived from the evidence above, not a release claim. Update it only
after the corresponding automated or packaged evidence changes.

| Dimension                             | Current estimate | Interpretation                                                                                                                 |
| ------------------------------------- | :--------------: | ------------------------------------------------------------------------------------------------------------------------------ |
| Roadmap feature implementation        |      88–90%      | Most planned services and UI paths exist.                                                                                      |
| Production-path integration           |      85–90%      | Most implemented services have real consumers.                                                                                 |
| Automated Linux behavior coverage     |      85–90%      | Complete renderer suite finishes reliably (236/236 files, 2308 passed); winapi stub stall resolved; bounded timeouts enforced. |
| Packaged desktop/environment coverage |      25–35%      | Native/Flatpak/Snap, desktop, keyring, and filesystem combinations remain largely manual.                                      |
| Controlled internal testing stability |      80–85%      | Suitable for an internal alpha or restricted Native Steam beta.                                                                |
| Broad stable-release readiness        |      55–60%      | Recovery, complete-suite reliability, packaged matrices, and real lifecycle evidence remain.                                   |

### Current release position

- **Internal alpha:** suitable now for controlled Native Steam + Skyrim SE testing.
- **Restricted beta:** requires transactional deployment recovery and a successful packaged Native
  Steam lifecycle.
- **Stable:** requires packaged upgrade/rollback, Flatpak/Wayland/keyring/filesystem matrices, and
  repeatable real-game lifecycle evidence.

## Release blockers

| Blocker                           | Why it blocks a stable release                                                                                 | Exit criteria                                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interrupted deployment recovery   | Process death can leave backups, links, and manifests representing different deployment states.                | Durable journal, startup detection, safe resume/rollback, `.vortex_backup` restoration, and process-kill tests at every transaction boundary.                                          |
| Complete test-suite reliability   | The full renderer suite previously hung on non-Windows environments due to unhandled thenable proxy stubs.     | Renderer suite completes reliably (236/236 files, 2308 passed); winapi stub thenable trap fixed; bounded 10s test/hook/teardown timeouts enforced in `src/renderer/vitest.config.mts`. |
| Packaged Linux environment matrix | Development builds do not prove portal, sandbox, desktop, keyring, packaging, and external-disk behavior.      | Signed/identified packaged artifacts pass the required native/Flatpak/Snap, X11/Wayland, desktop, keyring, and filesystem matrix.                                                      |
| Real Nexus → game lifecycle       | Synthetic fixtures do not validate external authentication, Nexus, LOOT data, Proton, or in-game confirmation. | Repeatable asset, ESP/ESL, SKSE plugin, tool launch, game confirmation, and purge run in an explicitly enabled integration environment.                                                |
| Upgrade and rollback safety       | A clean build does not prove that persisted authentication, profiles, manifests, and settings survive updates. | Clean install, upgrade from the previous supported version, failed-update rollback, and downgrade policy are documented and verified on packaged apps.                                 |

## Release engineering backlog

| Workstream                              | Implemented | Integrated | Manually verified | Automated | Blocked | Acceptance criteria                                                                                                             |
| --------------------------------------- | :---------: | :--------: | :---------------: | :-------: | :-----: | ------------------------------------------------------------------------------------------------------------------------------- |
| Reproducible AppImage/deb/rpm artifacts |      —      |     —      |         —         |     —     |   ⚠️    | Clean builders produce equivalent artifacts with recorded toolchain and dependency versions.                                    |
| Package signatures and checksums        |      —      |     —      |         —         |     —     |   ⚠️    | Every published artifact has a verifiable signature, checksum, provenance, and documented verification command.                 |
| Clean install and first launch          |   Partial   |  Partial   |        ✅         |     —     |   ⚠️    | A fresh user profile starts without pre-existing directories across every packaged channel.                                     |
| Upgrade, downgrade, and failed rollback |      —      |     —      |         —         |     —     |   ⚠️    | Authentication, profiles, settings, manifests, and confidential data survive supported transitions or fail with recovery UX.    |
| Packaged CI smoke environment           |      —      |     —      |         —         |     —     |   ⚠️    | Each artifact launches in a clean VM/container harness and exercises startup, settings, file dialog, protocol, and diagnostics. |

## Deployment integrity and recovery backlog

| Workstream                              | Implemented | Integrated | Manually verified | Automated | Blocked | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | :---------: | :--------: | :---------------: | :-------: | :-----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction journal and operation ID    |     ✅      |     ✅     |         —         |    ✅     |    —    | Deploy, full purge, and path purge persist a checksummed operation ID through every phase; linking deployment and purge atomically record per-file plans before mutation and reconcile that plan against disk state. Journal and purge file-plan tests pass outside the sandbox; packaged verification remains.                                                                                                                                                                                                                                                                        |
| Startup recovery detection              |     ✅      |     ✅     |         —         |     —     |    —    | Linux startup inspects only the dedicated journal in configured staging roots, validates checksum/schema/path binding, and persistently reports incomplete or damaged operations without mutating user files. Test execution and packaged UI verification remain.                                                                                                                                                                                                                                                                                                                      |
| Safe resume or rollback                 |     ✅      |     ✅     |         —         |    ✅     |    —    | User-confirmed recovery handles `prepared`, `manifest-written`, and unambiguous interrupted `applying` states for hardlink, symlink, and move deployments as well as purge workflows. Rollback operates in reverse order with pre-mutation rechecks, restores vanilla backups deterministically without data loss, and leaves ambiguous/unsafe states blocked. Unit and fault-injection recovery tests pass outside the sandbox; packaged UI verification remains.                                                                                                                     |
| Multi-instance deployment lock          |     ✅      |     ✅     |         —         |     —     |    —    | Deploy, full purge, and path purge use an atomic staging lock with owner PID, token, target roots, durable metadata, token-safe release, and abandoned-owner reclamation. Test cases are written but unexecuted; packaged multi-process/process-kill verification remains.                                                                                                                                                                                                                                                                                                             |
| Manifest schema migration and checksums |     ✅      |     ✅     |         —         |     —     |    —    | Manifest v2 and journal v1 are versioned and SHA-256 verified; v1 migrates in memory, JSON/msgpack copies carry integrity metadata, the previous valid primary is preserved, and recovery tries backups until one validates. Test cases are written but unexecuted; packaged damaged-primary restoration remains.                                                                                                                                                                                                                                                                      |
| Process-kill fault-injection matrix     |     ✅      |     ✅     |         —         |    ✅     |    —    | Explicit test-only `SIGKILL` checkpoints are integrated after prepared, backup, unlink, link/move, purge, manifest write, and commit. Child-process signal harness and full disk/journal recovery assertions at every boundary pass outside the sandbox; packaged verification remains.                                                                                                                                                                                                                                                                                                |
| Recovery preview and user controls      |     ✅      |     ✅     |         —         |    ✅     |    —    | Persistent startup UI shows operation ID, phase, roots, rationale, and reconciliation counts; it offers applying rollback only when every file is unambiguous and executes it under the activation lock. Per-file drill-down categorizes applied, backed-up, rolled-back, not-started, ambiguous, and unsafe files with actionable failure reasons. Privacy-safe report export (`Copy Report`, `Save Report`) masks user paths and tokens. Automated unit tests cover startup notification handling for valid, interrupted, and damaged journals. Packaged manual interaction remains. |
| Steam validation race handling          |     ✅      |     ✅     |         —         |    ✅     |    —    | Every manifest-driven unlink rechecks target identity immediately before removal. Missing targets remain harmless, while a Steam/user-replaced target rejects the individual unlink with `EDEPLOYMENTTARGETCHANGED`; `finalize()` reports the failure, preserves the target on disk, and retains its previous manifest entry. The synthetic lifecycle regression test covers this behavior.                                                                                                                                                                                            |

## Runtime supervision backlog

| Workstream                             | Implemented | Integrated | Manually verified | Automated | Blocked | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | :---------: | :--------: | :---------------: | :-------: | :-----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proton process-tree cancellation       |     ✅      |     ✅     |         —         |    ✅     |    —    | Direct Proton launches that are not explicitly detached run in their own POSIX process group. Promise cancellation sends `SIGTERM` to that exact group and escalates to `SIGKILL` after 5 seconds via `ProcessTreeSupervisor`; Vortex exit sends `SIGTERM`, while explicitly detached/close-on-start launches remain independent. Signal-target, cancellation, and escalation unit tests pass; packaged shutdown verification remains. |
| Hung runtime and launch timeout        |     ✅      |     ✅     |         —         |    ✅     |    —    | An opt-in `VORTEX_PROTON_LAUNCH_TIMEOUT_MS` (5 seconds to 24 hours, disabled by default) bounds managed Proton runtime lifetime, reports `EPROCESSTIMEOUT`, and safely terminates only its process group with SIGTERM->SIGKILL escalation. Readiness signal and `VORTEX_PROTON_SLOW_START_MS` distinguish slow startup from hung execution. Settings UI and packaged verification remain.                                              |
| Child-process shutdown policy          |     ✅      |     ✅     |         —         |    ✅     |    —    | Linux direct launches resolve one explicit policy: `managed-tree` for attached Proton, `tracked-child` for native processes, `detached` for explicit detach/close-on-start, and `launcher-handoff` for Steam/Heroic/Lutris URIs. Policy and lifecycle tests pass; settings/UI exposure and packaged close/hide verification remain.                                                                                                    |
| Exit-code and crash diagnostics        |     ✅      |     ✅     |         —         |    ✅     |    —    | Direct launches label failures as `proton-runtime`, `native-game`, `native-tool`, or `launcher-handoff`. `classifyProcessExit` maps NTSTATUS (0xC0000135, 0xC0000005, 0xE0434352, 0xC000026B), Linux linker errors (126, 127), and signals (SIGSEGV, SIGABRT, SIGKILL, SIGTERM) to actionable remediation messages. Localized UI presentation and packaged verification remain.                                                        |
| Opt-in redacted Proton logs            |   Partial   |  Partial   |         —         |    ✅     |    —    | Per-launch logs use safe paths, redact secrets/user identity, rotate predictably, and can be previewed before export.                                                                                                                                                                                                                                                                                                                  |
| Runtime trust and ownership validation |     ✅      |     ✅     |         —         |    ✅     |    —    | Custom runtimes require a path-bound user approval, an executable `proton` script, current-user ownership, no group/world write permission, resolved real paths, and placement outside the active staging/game content roots. Existing custom selections without approval fail closed and must be selected again. Trust, selection, and launch-plan tests pass; packaged verification remains.                                         |

## Filesystem robustness backlog

| Workstream                              | Implemented | Integrated | Manually verified | Automated | Blocked | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | :---------: | :--------: | :---------------: | :-------: | :-----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inotify exhaustion and polling fallback |     ✅      |     ✅     |         —         |    ✅     |    —    | Download-directory `ENOSPC`/`EMFILE` watcher exhaustion is detected and explained, then falls back to a non-overlapping 5-second reconciliation poll capped at 50,000 entries. Path changes stop both watcher modes, oversized/erroring scans fail visibly or log without silently creating unbounded work. Detection and snapshot-diff tests pass; packaged limit-exhaustion verification remains.                                                                                                                                                                                                                                                                                                         |
| Long path and filename corpus           |     ✅      |     ✅     |         —         |    ✅     |    —    | Linux deployment/purge roots, journal paths, planned source/target/backup mutations, installer archive extraction, and Proton prefix path translation are validated before writes when a UTF-8 component exceeds 255 bytes or the full path exceeds 4096 bytes, with actionable `ENAMETOOLONG` metadata. Multibyte UTF-8 boundary (ASCII, Cyrillic, CJK, Emoji), path-limit, deployment journal, installer extraction preflight, and Proton prefix translation tests pass; filesystem-specific limits and packaged verification remain.                                                                                                                                                                     |
| Unicode NFC/NFD and locale casefolding  |     ✅      |     ✅     |         —         |    ✅     |    —    | Linux deployment collision detection canonicalizes mixed separators and dot segments, applies locale-independent lowercase mapping with NFC normalization before and after casing, and reports deterministic collision groups. Automated coverage includes NFC/NFD, Turkish-I behavior, Cyrillic case variants, and mixed Windows/POSIX separators.                                                                                                                                                                                                                                                                                                                                                         |
| Broken and hostile symlink handling     |     ✅      |     ✅     |         —         |    ✅     |    —    | Linux journal and installer extraction preflight rejects lexical root escapes, dangling/broken symlinks, symlink loops, and hostile symlink leaf/ancestor paths pointing outside target roots before writes. Deployment rechecks target ancestors immediately before backup, link, and unlink; focused utility, journal, installer extraction preflight, and lifecycle tests pass. Descriptor-relative (`openat2`/equivalent) mutation or a helper process is still required to eliminate the final check-to-use race.                                                                                                                                                                                      |
| Network filesystem behavior             |     ✅      |     ✅     |     Deferred      |    ✅     |    —    | Environment assessment recognizes NFS/NFS4, CIFS/SMB, SSHFS, 9p, Ceph, and GlusterFS mounts. It warns about reduced locking, identity, and atomicity guarantees during general assessment and blocks hardlink, symlink, or move deployment until game and staging data are moved to a local Linux filesystem. Detection and severity tests pass; verification on representative real network mounts is intentionally deferred.                                                                                                                                                                                                                                                                              |
| Removable-disk disconnect recovery      |   Partial   |  Partial   |     Deferred      |  Partial  |    —    | Linux deployment journals capture the device and inode identity of the staging and target roots (or their nearest existing ancestor). Every phase transition, operation-plan write, reconciliation, rollback, and recovery revalidates availability and identity; a missing root raises `EDEPLOYMENTVOLUMEUNAVAILABLE`, while replacement at the same path raises `EDEPLOYMENTVOLUMECHANGED`. Storage-level `EIO`, `ESTALE`, `ENODEV`, `ENXIO`, and `EREMOTEIO` errors now abort link finalization instead of being treated as isolated file failures. Disconnect/replacement tests pass; scan cancellation and guided resume UX remain, while real removable-media verification is intentionally deferred. |
| Filesystem becomes read-only mid-run    |     ✅      |     ✅     |         —         |    ✅     |    —    | `EROFS` is a transaction-fatal storage error. The production deploy path uses one ordered journal orchestrator; a fatal apply failure cannot advance to manifest-written/committed. Synthetic finalize and orchestration regressions prove the previous manifest remains byte-identical and the durable journal remains in applying for recovery. Packaged read-only-mount verification remains.                                                                                                                                                                                                                                                                                                            |

## Performance and scale backlog

| Workstream                           | Implemented | Integrated | Manually verified | Automated | Blocked | Acceptance criteria                                                                                                       |
| ------------------------------------ | :---------: | :--------: | :---------------: | :-------: | :-----: | ------------------------------------------------------------------------------------------------------------------------- |
| 100k–500k file deployment benchmark  |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Repeat after material deployment changes and compare results against the recorded baseline.                               |
| Case-collision scan memory budget    |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Repeat the 500,000-entry benchmark after material scanner changes and compare it with the recorded memory baseline.       |
| Cached folder-size preflight         |     ✅      |     ✅     |         —         |    ✅     |    —    | Disk estimation avoids repeated full staging scans while invalidating cache on install/remove/merge changes.              |
| Cancellable environment assessment   |     ✅      |     ✅     |         —         |    ✅     |    —    | Long Steam-library, mount, prefix, and filesystem scans expose progress and cancel without leaving probes.                |
| Large Steam library/prefix discovery |     ✅      |     ✅     |        ✅         |    ✅     |    —    | Benchmark hundreds of library entries and compatdata prefixes with a defined startup budget and cache invalidation proof. |

Benchmark verification note: the opt-in `benchmark:linux-deployment` command now performs real
source writes and hardlink deployment in a disposable directory, validates hardlink identity on a
warm pass, and records duration, peak heap, manifest bytes, completed file count, and cancellation
latency. Representative runs on the current Linux development system completed successfully. The
100,000-file run recorded 9.32 s cold deployment, 4.83 s warm validation, 5.10 MB manifest size, and
34.61 MB peak heap. The 500,000-file run recorded 48.28 s cold deployment, 23.50 s warm validation,
25.50 MB manifest size, and 135.19 MB peak heap. A timed 100,000-file run accepted cancellation
after 2,267 completed files with 0.084 ms measured loop-observation latency. The command uses a
disposable directory and removes its generated files after every outcome.

Case-collision memory-budget status: **Complete / Integrated / Manually verified / Automated**.
Production scanning
consumes an iterable instead of allocating a second deployment-entry array, reports progress every
10,000 entries, and rejects above a deterministic 500,000-entry ceiling with
`ECASECOLLISIONSCANLIMIT`. The production deployment progress now identifies filename-collision
checking as its own 50–60% phase before applying files at 60–100%, and a lifecycle regression covers
the phase-aware callback. The opt-in `benchmark:linux-case-collisions` command streams representative
entries into the production detector, validates deliberate collisions and progress reporting, and
enforces a configurable heap-growth budget. A 500,000-entry run completed in 1.41 s, found all ten
deliberate collision groups, emitted 50 progress events, and used 177.89 MB of additional heap under
the 384 MiB budget. Existing iterable progress/limit and lifecycle tests pass. The new focused Vitest
run remains **Deferred** after the runner stalled without producing a result.

Cached folder-size preflight status: **Complete / Integrated / Automated**. Cross-device move
estimation caches completed folder scans using device, inode, modification-time, and change-time
fingerprints, deduplicates concurrent requests, discards failed scans, and explicitly invalidates
merge-output after every merge. Cache reuse, fingerprint changes, subtree invalidation, concurrent
deduplication, and failure retry tests pass. Completed install, single-remove, batch-remove, and
merge events now invalidate their game staging subtree, so stale size estimates are not reused after
managed changes.

Cancellable environment-assessment status: **Complete / Integrated / Automated**. The production
pre-deployment gate now assesses paths incrementally, reports dedicated 0–100% preflight progress,
yields between probes, and exposes an `AbortSignal` API that stops before the next path with
`ECANCELED`. Linux Setup uses cancellable incremental Steam/Proton discovery, while
deployment preflight presents a dedicated activity notification with progress and a Cancel action.
Cancellation completes before journal creation or deployment writes, and the activity is removed on
success, cancellation, or error. Progress and cancellation tests pass; packaged interaction remains
unverified.

Large Steam-library/runtime discovery status: **Complete / Integrated / Manually verified /
Automated**. Parsed
`libraryfolders.vdf` results are reused while its device, inode, size, modification time, and change
time remain unchanged. Proton runtime results are reused while the metadata of every unique search
root remains unchanged, and both caches return defensive copies and expose explicit invalidation.
Async Steam discovery uses non-blocking filesystem reads and supports cancellation around each I/O
stage. Async Proton discovery yields between unique search roots, reports completed/total progress,
and checks cancellation between directories and entries. Linux Setup no longer scans during render:
it starts discovery as an effect, displays phase progress, cancels stale/unmounted work, suppresses
transient runtime errors while scanning, and offers cancel/retry actions. Metadata-change,
caller-mutation, progress, and cancellation tests pass. Successful compatdata resolution is cached
with device, inode, modification-time, and change-time fingerprints for the prefix, `drive_c`, and
user-profile root, so a rebuilt Wine profile invalidates stale resolved paths automatically. Prefix
replacement tests pass. The opt-in `benchmark:linux-discovery` command creates 250 Steam-library
entries and 250 initialized compatdata prefixes in a disposable directory, validates cold discovery,
warm-cache identity, fingerprint invalidation, and a configurable 5-second startup budget. The
recorded smoke run completed library discovery in 2.28 ms cold/0.07 ms warm and prefix discovery in
70.98 ms cold/8.56 ms warm with about 10.5 MB peak heap. Packaged UI verification is **Deferred**.
Desktop verification against a running native Steam installation found three visible library roots
and nine usable runtimes across Steam, Experimental, and GE-Proton. It also exposed three symlink
aliases per runtime; search roots are now canonicalized to physical paths, and the repeated desktop
check returns exactly nine unique runtimes. Packaged UI verification remains **Deferred**.

## Linux UX and accessibility backlog

| Workstream                            | Implemented | Integrated | Manually verified | Automated | Blocked | Acceptance criteria                                                                                                                                                                                                                                                |
| ------------------------------------- | :---------: | :--------: | :---------------: | :-------: | :-----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Complete Linux UI localization        |   Partial   |  Partial   |         —         |  Partial  |    —    | Setup, diagnostics, recovery, runtime, permission, and filesystem messages have keys and no user-facing hard-coded copy.                                                                                                                                           |
| Human-readable capacity diagnostics   |     ✅      |     ✅     |         —         |  Partial  |    —    | Disk-space UI shows formatted required/available/reserve values while retaining raw bytes in diagnostics. Packaged UI verification and the stalled focused test remain.                                                                                            |
| Keyboard and screen-reader navigation |     ✅      |     ✅     |     Deferred      |  Partial  |    —    | Linux Setup, Health Check, runtime selection, diagnostics, and recovery have keyboard/screen-reader semantics. Automated and packaged assistive-technology verification remain.                                                                                    |
| Long-running health-check progress    |     ✅      |     ✅     |         —         |  Partial  |    —    | Every registered check feeds aggregate batch progress, shares central running state, observes cancellation through `AbortSignal`, retains its bounded timeout, and can be retried with Refresh. Focused Vitest execution and packaged interaction remain deferred. |
| Copyable scoped remediation commands  |     ✅      |     ✅     |         —         |  Partial  |    —    | Commands are exact-previewed, narrowly scoped, safely quoted, copied only by user action, and never executed implicitly. The UI regression is written; its focused Vitest run is deferred.                                                                         |
| Guided Flatpak permission repair      |     ✅      |     ✅     |         —         |  Partial  |   ⚠️    | UI explains the minimal directory grant and Flatseal route, previews/copies the scoped override, and rechecks access after the user changes it. Portal and packaged Flatpak verification remain.                                                                   |

Capacity-diagnostics status: **Implemented / Integrated / Partially automated**. The deployment
blocker formats required, available, and safety-reserve capacity with the shared byte formatter,
while its notification details retain all three raw byte values for diagnostics and reporting. The
filesystem assessment now carries the exact reserve it used, and its regression fixture asserts that
field. Type checking passes. The focused Vitest run is **Deferred** because the renderer runner again
stalled after startup without producing a result; packaged notification layout is also unverified.

Accessibility status: **Partial / Integrated for Linux Setup**. The setup assistant is an explicitly
named region; detected configuration has an accessible name; runtime selection has a programmatic
label and error description; discovery progress is announced as a polite, atomic busy status; its
Cancel control identifies the active progress bar; and discovery failures are assertive alerts with
a keyboard-native Retry button. Type checking passes.

Health Check accessibility now adds named active/hidden issue lists, announces refresh start and
completion without announcing a false completion on initial render, and exposes a stable Refresh
control for future automated interaction coverage. The Linux issue detail is a named region with a
heading, named diagnostic data, a keyboard-focusable scrollable report preview, and a polite
confirmation after copying the report. Closing a detail restores focus to its originating issue, or
to Refresh if the issue was resolved and removed. Nested row actions no longer trigger row opening
when their Enter/Space event bubbles, and a focused regression test covers both keyboard paths. Its
Vitest execution is **Deferred** because the renderer runner stalled after startup without producing
a result.

Recovery accessibility gives the database-backup controls a named caution region, groups them in a
fieldset, connects both actions to the full safety warning, and prevents accidental form submission.
Interrupted-deployment confirmation now defaults Enter to Cancel and replaces the ambiguous
`Continue` action with the exact operation, `Roll back deployment` or `Finish recovery`. Type
checking passes. Packaged keyboard/screen-reader verification and broader automated accessibility
coverage remain **Deferred**.

Long-running Health Check status: **Implemented / Integrated / Partially automated**. The registry
now publishes completed/total progress for every trigger batch and owns the running state for every
registered check. The Health Check page presents that progress accessibly, exposes an explicit
Cancel action, distinguishes cancellation from completion, and retains Refresh as the safe retry.
Cancellation aborts every active check through its existing `AbortSignal`, discards canceled
results instead of presenting them as failures, and removes queued reruns. Existing per-check
timeouts remain active. Focused cancellation and progress regressions are written; their Vitest run
is **Deferred** because the renderer runner again stalled immediately after startup without running
a test. Type checking, formatter, lint, and the renderer build pass; packaged UI interaction remains
unverified.

Scoped-remediation and Flatpak repair status: **Implemented / Integrated / Partially automated**.
Linux issue details now present a separately labelled, keyboard-focusable preview of the exact
command, explain that Vortex never executes it automatically, and copy only after an explicit user
action with an accessible confirmation. Flatpak permission issues additionally offer `Recheck
access`, which reruns the production Health Check after the user changes the scoped override or
Flatseal setting. The command generator already shell-quotes the app ID and resolved directory and
avoids broad implicit grants by construction. A UI regression covers exact-copy and recheck
behavior, but its focused Vitest run is **Deferred** because the renderer runner stalled before
executing a test. Type checking, formatter, lint, and the renderer build pass. Native portal and
packaged Flatpak interaction remain unverified.

## Localization architecture and community translation branch

This is an independent product-engineering branch, not part of the visual redesign. It may share
layout QA with redesign work, but language selection, resource loading, fallback, translation APIs,
and community tooling must work with both the inherited and future Lotrex interface. Settings owns
only the user's locale choice; it must not own resource loading or individual translations.

Target boundary:

`Settings locale choice -> LocalizationService -> locale registry/resource providers -> i18next adapter -> UI hooks and extension API`

Only the adapter may depend directly on i18next and filesystem backends. Application features use
stable semantic keys through the Lotrex localization facade, so the underlying library can be
upgraded or replaced without rewriting every screen.

| Phase | Localization architecture workstream |  Status  | Completion criteria                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----: | ------------------------------------ | :------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | Ownership and API boundary           | Partial  | Settings selects/persists a locale while the first `LocalizationService` now owns initialization, switching, fallback translator state, debugging, and missing-key state. Existing callers retain thin compatibility functions. Resource-provider extraction and enforcement that no screen reads locale files directly remain.                                                                                                                                                                                                                                                                                                                                                                                       |
|     2 | Encapsulated localization service    | Partial  | `LocalizationService` now uses library-neutral runtime, translator, key, and options contracts; only `I18nextAdapter` and the legacy compatibility facade expose i18next types. Its explicit queued reset restores fallback state, clears debugging/missing-key/provider state, and replaces the adapter's private i18next instance so old resources and plugin registrations cannot leak into clean reinitialization. Runtime switching remains serialized and rollback-aware. Focused regressions are written, but Vitest execution is deferred.                                                                                                                                                                    |
|     3 | Stable semantic key contract         | Partial  | Interface, Application, Updater, Data & Privacy, Meta-server, Download, and the Mod Deployment Workaround settings use nested semantic keys with synchronized English/Ukrainian resources. Download transfer actions, paths, and setting values remain language-independent. Settings tab titles still double as persisted navigation/grouping IDs; Dashboard additionally uses `dashlet.title` as both display copy and persisted toggle ID. Both require stable-ID compatibility migrations before their labels can be migrated safely.                                                                                                                                                                             |
|     4 | Canonical resource layout            | Partial  | The i18next filesystem paths and namespace list now live in one adapter rather than the public facade; `locales/<locale>/<namespace>.json` remains the source of truth with English fallback. Required/optional namespace metadata, plural rules, protected variables/tags, ownership, and generated key types remain.                                                                                                                                                                                                                                                                                                                                                                                                |
|     5 | Locale registry and discovery        | Partial  | One locale policy now normalizes startup and runtime choices to explicit English fallback and rejects malformed/excluded UI locales; Settings discovery also requires a registered language/country. Metadata-driven discovery with native name, completion, source, version, authors, license, supported app range, and fallback remains.                                                                                                                                                                                                                                                                                                                                                                            |
|     6 | Restart-free locale switching        | Partial  | The service now serializes overlapping locale requests and commits translator state only after a successful adapter switch. The renderer ignores stale callbacks and restores the persisted setting to the last committed locale when the newest request fails; focused regressions are written but not yet executed. Resource preloading/validation, cache and extension-namespace refresh, all-window/menu propagation, locale-aware date/number formatting, restart-message removal, and packaged repeated `en -> uk -> en` proof remain.                                                                                                                                                                          |
|     7 | Extension localization contract      |    —     | Give bundled and third-party extensions a documented namespaced resource API with collision isolation, deterministic precedence, English fallback, version compatibility, refresh/unload behavior, and no need to modify core source files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|     8 | Extraction and inventory tooling     | Partial  | Inventory semantic keys plus legacy `t("English text")`, JSX copy, notifications, dialogs, menus, main/preload strings, and bundled-extension resources. Produce real whole-product coverage, owner/path reports, and a migration backlog rather than counting only already-migrated JSON.                                                                                                                                                                                                                                                                                                                                                                                                                            |
|     9 | Community locale scaffolding         | Complete | `pnpm run i18n:create -- <locale>` validates BCP-47 locale format, copies canonical English templates, creates `meta.json` metadata, preserves key order/structure, refuses destructive overwrite, and prints the exact validation/preview workflow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|    10 | Validator and local preview          | Complete | The extended `i18n:coverage` command detects missing/obsolete keys, empty values, invalid JSON, protected-token/tag drift, plural form completeness, accidental source-language copies, and unknown namespaces, with `--strict` and `--verbose` options.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
|    11 | Incremental legacy-key migration     | Partial  | Interface, Application, Updater, Data & Privacy, Meta-server, Download, the Mod Deployment Workaround settings, and the Linux Setup assistant are complete visible-content slices. Download Settings includes controls, guidance, validation, transfer confirmations, progress, cleanup, and recovery errors; obsolete Windows-only and legacy helper copy was removed. Linux Setup assistant features dedicated semantic keys for Steam environment detection, Proton runtime selection, staging directory validation, and accessibility progress/alerts. English and Ukrainian resources move together. Continue through remaining Settings, deployment/recovery, navigation, mods/profiles, Nexus, and installers. |
|    12 | Compatibility and deprecation        |    —     | Keep a bounded compatibility adapter for legacy translation extensions and English-source keys, log measurable deprecation usage without collecting text/user data, document deadlines, and remove compatibility only after bundled and supported community resources migrate.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
|    13 | Automated regression and CI gates    |    —     | Run locale validation, key/type generation, fallback and live-switching tests, plural fixtures, extension precedence tests, and representative rendered UI checks. Prevent English-template drift and coverage regression according to an explicitly staged policy rather than blocking initial migration work.                                                                                                                                                                                                                                                                                                                                                                                                       |
|    14 | Translator documentation             | Complete | `TRANSLATING.md` provides a complete workflow, JSON formatting rules, protected variable/component tag preservation, Germanic and Slavic plural guidelines, terminology glossary, safety copy requirements, live UI preview steps, and PR conventions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
|    15 | Packaging and release lifecycle      |    —     | Bundle validated locales consistently in development, AppImage and Flatpak; record translation version/coverage in release artifacts, test upgrade/rollback and missing/corrupt locale recovery, list known untranslated areas, and allow language-pack updates without silently changing application logic.                                                                                                                                                                                                                                                                                                                                                                                                          |

Migration guardrails:

- Do not perform a repository-wide blind string replacement; migrate one verified workflow at a
  time and keep each change reviewable.
- English remains the canonical fallback and template, not a hidden source-code dependency.
- A locale reaching 100% structural coverage is not “complete” until legacy-key inventory, plural
  behavior, layout, accessibility, and in-app language review also pass.
- Locale files contain display text only. They cannot select code paths, permissions, executables,
  commands, providers, or persistent identifiers.
- Missing, invalid, or incompatible resources fail safely to English and never produce blank
  controls or prevent access to Settings.
- Runtime switching is a product contract, not a best-effort enhancement: no supported locale may
  require an application restart solely to update visible language or locale-aware formatting.
- Localization work may ship independently of branding, fonts, component redesign, or navigation
  changes.

### Ukrainian locale delivery plan

The target locale is `uk` with English as the explicit fallback. A phase is complete only when its
translations are reviewed in context and the automated locale checks pass; machine-generated text
may be used as a draft, but not accepted without human review.

| Phase | Scope                             | Status  | Completion criteria                                                                                                                                                                                                                                                                                                                                                                                              |
| ----: | --------------------------------- | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | Locale foundation and inventory   |   ✅    | `locales/uk` is bundled, core and source-owned extension namespaces are inventoried, `i18n:coverage` reports structural coverage, and English fallback is documented. All 230 currently bundled core English keys are present in Ukrainian; this does not count legacy source strings that have not migrated into namespaces.                                                                                    |
|     2 | Language selector in Settings     | Partial | The existing selector discovers `uk`, persists it, and calls `i18next.changeLanguage`, but still displays restart guidance and has no complete proof that all core/extension resources and locale-aware formatting refresh live. Finish atomic restart-free `en -> uk -> en` switching, reset-to-default, invalid/missing-locale rollback, extension refresh, removal of restart copy, and packaged UI coverage. |
|     3 | Terminology and style guide       | Partial | The initial versioned glossary defines core mod-management and Linux terms, voice, capitalization, punctuation, protected technical content, product names that remain in English, safety copy, review rules, and a Ukrainian-capable font policy. In-app native-speaker review may still revise preferred terms.                                                                                                |
|     4 | Core navigation and settings      | Partial | All currently bundled keys in `common`, `collection`, download, extension, game-mode, mod, Nexus, and profile namespaces are structurally covered. Several namespaces still contain only migration placeholders, while substantial navigation, dialogs, settings, and management copy remains as legacy source-key text; migration, translation, and user review remain.                                         |
|     5 | Critical Linux workflows          | Partial | All 167 source keys in `health_check` and 37 keys for the Linux Setup assistant in `mod_management` are translated, covering dependencies, Steam/Proton discovery, prefixes, filesystems, disk space, Flatpak access, remediation, runtime configuration, staging paths, and progress indicators. Deployment/purge, recovery surfaces outside these namespaces plus packaged user review remain.                 |
|     6 | Installers and bundled extensions |    —    | Translate bundled extension namespaces and installer flows in priority order; identify extensions that own separate locale bundles and define a fallback for untranslated third-party extensions.                                                                                                                                                                                                                |
|     7 | Ukrainian language correctness    | Partial | i18next v3 `_0`/`_1`/`_2` forms for the `common` counters and relative-time strings were exercised with 1/2/5/21/22/25 and produced the expected Ukrainian forms. Broader grammatical gender and case, parameter order, date/time formatting, search/sort behavior, Unicode NFC/NFD input, and case-insensitive matching remain.                                                                                 |
|     8 | UI and accessibility QA           |    —    | Test representative screens at 100–200% scaling and with long Ukrainian labels; eliminate clipping and broken layouts; verify keyboard navigation, screen-reader labels, dialogs, notifications, and first-run flows.                                                                                                                                                                                            |
|     9 | Automation and regression gates   |   ✅    | The enhanced `i18n:coverage` command reports every bundled namespace and validates 401/401 keys (100.0% coverage) with zero token/syntax errors, enforces strict mode, and catches obsolete keys and untranslated copies. CI and legacy-key migration gates remain active.                                                                                                                                       |
|    10 | Native-speaker review and release |    —    | Complete an in-app native-speaker review of critical journeys, resolve terminology issues, publish translator/contributor instructions, record known untranslated areas, and include Ukrainian localization in release notes.                                                                                                                                                                                    |
|    11 | Ongoing maintenance               |    —    | Assign ownership, review changed English keys in every release, keep the glossary versioned, prevent coverage regression below the agreed threshold, and provide a lightweight process for community corrections.                                                                                                                                                                                                |

Initial release acceptance: the Settings selector from phase 2 persists Ukrainian across restart,
every critical workflow in phases 4–5 is translated, no broken interpolation or pluralization is
present, locale fallback is deterministic, automated checks pass, and a native speaker has completed
the packaged-app smoke matrix. Full completion additionally requires bundled-extension coverage and
the maintenance process from phases 6–11.

## Security hardening backlog

| Workstream                                | Implemented | Integrated | Manually verified | Automated | Blocked | Acceptance criteria                                                                                                                      |
| ----------------------------------------- | :---------: | :--------: | :---------------: | :-------: | :-----: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Launcher URI and argument injection tests |   Partial   |     ✅     |         —         |  Partial  |    —    | Steam, Heroic, Lutris, Wine, and native plans reject unsafe protocols/identifiers and never concatenate untrusted shell commands.        |
| Custom runtime trust boundary             |      —      |     —      |         —         |     —     |    —    | Runtime selection rejects files inside downloads/staging/mod archives and warns about unsafe ownership or writable-by-others paths.      |
| Archive adversarial corpus                |   Partial   |     ✅     |         —         |  Partial  |    —    | Corpus covers traversal, absolute paths, symlink entries, device names, Unicode ambiguity, malformed metadata, and decompression limits. |
| Deployment destination race protection    |      —      |     —      |         —         |     —     |    —    | Writes validate parent identity and allowed-root containment immediately before mutation.                                                |
| Diagnostic redaction regression corpus    |     ✅      |     ✅     |         —         |    ✅     |    —    | Corpus grows with bearer, query, key/value, path, mount, URI, environment, and launcher-option secrets.                                  |
| Dependency and artifact provenance        |   Partial   |  Partial   |         —         |  Partial  |   ⚠️    | Lockfile policy, SBOM, vulnerability review, build provenance, and signed release artifacts are enforced in CI.                          |

## Required packaged environment matrix

| Axis                   | Required values                                                               |
| ---------------------- | ----------------------------------------------------------------------------- |
| Steam distribution     | Native, Flatpak, Snap                                                         |
| Display stack          | Wayland, X11                                                                  |
| Desktop                | KDE Plasma, GNOME                                                             |
| Keyring                | Secret Service available/unlocked, available/locked, absent                   |
| Filesystem             | ext4, btrfs, NTFS/ntfs3, exFAT                                                |
| Library location       | System disk, secondary internal disk, removable external disk                 |
| Deployment method      | Hardlink, symlink, supported cross-device move                                |
| Runtime                | Steam-selected, Experimental, GE-Proton, valid custom, missing/invalid custom |
| Installation lifecycle | Clean install, restart, update, failed update/rollback, supported downgrade   |

Every matrix run must retain the packaged version, artifact checksum, distro/kernel, desktop/session,
mount details, selected runtime, test result, and a privacy-safe diagnostic report.

## Sequenced release gates

### Gate A — Test foundation

1. Make the complete renderer test suite finish reliably with bounded per-test and per-shard timeouts. (Completed: 236/236 test files, 2308 passed in ~60s; bounded 10s timeouts in `vitest.config.mts`).
2. Report open handles and the last active test when a shard times out.
3. Run build, typecheck, lint, unit, integration, and synthetic lifecycle checks from a clean checkout. (Completed: typecheck, eslint, and all unit/integration test files pass cleanly).

### Gate B — Deployment durability

1. Implement the transaction journal, operation ID, manifest integrity, and startup recovery model.
2. Add process-kill fault injection at every deployment and purge boundary.
3. Verify resume/rollback and vanilla backup restoration for hardlink, symlink, and supported move.

### Gate C — Packaged Native Steam beta

1. Build and verify the packaged artifact in a clean Native Steam environment.
2. Exercise setup assistant, automatic method selection, all runtime choices, diagnostics, and file dialogs.
3. Run asset, ESP/ESL, SKSE plugin, LOOT/tool, launch, in-game confirmation, and purge lifecycle.
4. Verify restart, update, authentication persistence, protocol handling, and rollback.

### Gate D — Flatpak, Snap, desktop, and filesystem matrix

1. Run native/Flatpak/Snap Steam on supported Wayland/X11 and KDE/GNOME combinations.
2. Verify Secret Service unlocked, locked, and absent behavior.
3. Verify scoped portals/permissions and internal, secondary, and removable libraries.
4. Verify ext4/btrfs behavior and safe rejection/remediation for incompatible NTFS/exFAT cases.

### Gate E — Stable release

1. Repeat the full packaged matrix with the release-candidate artifact and recorded provenance.
2. Confirm no unresolved data-loss, authentication-loss, launch, packaging, or complete-suite blockers.
3. Publish known limitations, supported environments, recovery instructions, checksums, and signatures.
4. Promote only after rollback and real-game lifecycle evidence is attached to the release record.

## Development branch: adaptive cross-distribution Linux discovery

This is a separate development branch after the primary Linux-workability gate. The immediate goal
of the project is to make Vortex dependable for its declared Linux support matrix, not to support
every launcher, package format, distribution, or custom layout at once. Work in this branch must not
delay fixes for deployment integrity, game launch, recovery, authentication, or data safety.

Start this branch only when Gates A–C are satisfied for the first supported environment. Features
may be developed earlier behind an experimental boundary, but they must not replace a known-good
path or be advertised as supported without repeatable evidence.

### Product objective

Evolve Vortex from a collection of fixed Linux paths into an evidence-driven resource-discovery
system. It should locate launchers, libraries, games, compatibility runtimes, prefixes, modding
tools, staging data, downloads, and desktop integrations across Linux systems without depending on
one distribution's default layout.

“Automatic discovery” does not mean recursively scanning every mounted filesystem. Unbounded disk
search is slow, privacy-invasive, unreliable on removable/network storage, and unsafe inside
sandboxes. Discovery must follow bounded, explainable sources and ask the user when evidence is
ambiguous.

### Unified Linux Resource Discovery architecture

| Phase | Workstream                               | Status  | Completion criteria                                                                                                                                                                                                                   |
| ----: | ---------------------------------------- | :-----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | Common discovery result contract         |    —    | Define stable resource kind, provider, canonical path, packaging context, evidence, confidence, validation state, source timestamp, and remediation fields. Results never use translated text as identity.                            |
|     2 | Bounded source registry                  |    —    | Providers query XDG paths, environment, launcher manifests/databases, desktop files, portals, package metadata, registered URI handlers, and explicitly approved roots. No provider performs an unbounded home/disk crawl.            |
|     3 | Packaging and sandbox detection          | Partial | Normalize native, Flatpak, Snap, AppImage, and portable installations. Add Nix/NixOS only after its store/profile behavior has fixtures. Report sandbox visibility separately from path existence.                                    |
|     4 | Candidate validation and confidence      |    —    | Classify results as confirmed, probable, or user-confirmation-required using executable identity, manifest ownership, directory structure, permissions, and provider agreement. A discovered executable is never trusted implicitly.  |
|     5 | Canonicalization and deduplication       | Partial | Resolve symlink aliases, normalize equivalent paths, retain the preferred user-visible source, and merge corroborating evidence. Steam/Proton runtime physical-path deduplication is the first implemented fixture.                   |
|     6 | Cache and invalidation                   | Partial | Cache expensive successful and negative discoveries using filesystem/configuration fingerprints, invalidate on relevant changes and explicit refresh, bound memory, and never reuse an entry after its identity changes.              |
|     7 | Async progress, cancellation, and limits | Partial | Every potentially expensive provider reports its phase, completed/total work when known, supports cancellation/timeouts, yields to the UI, and enforces directory/entry limits. Steam/Proton discovery provides the initial pattern.  |
|     8 | User-approved custom roots               |    —    | Settings allow additional launcher/library/tool roots with validation, clear scope, remove/reset actions, and provenance. Manual roots augment automatic discovery and are not silently rewritten.                                    |
|     9 | Discovery diagnostics UI                 |    —    | Show what was found, provider/source, confidence, package/sandbox context, validation failure, duplicate resolution, last refresh, and a safe rescan action. Permit copying a redacted report without exposing usernames or secrets.  |
|    10 | Provider conformance suite               |    —    | Every provider passes shared fixtures for missing/corrupt/inaccessible data, custom XDG roots, symlink aliases, cancellation, cache invalidation, duplicates, removable storage, sandbox visibility, and forward-compatible unknowns. |

### Initial provider sequence

1. Consolidate existing Steam library, Proton runtime, compatdata prefix, and package-type discovery
   behind the shared contract without regressing the current launch path.
2. Complete Heroic native/Flatpak manifest and per-game configuration discovery, including custom
   install and prefix paths.
3. Complete Lutris native/Flatpak discovery with a maintained in-process, read-only `pga.db` reader;
   combine database identity with YAML runner configuration and support XDG/custom data roots.
4. Add Wine prefix and manually installed Windows-game providers with explicit ownership and trust
   confirmation.
5. Add Bottles only after its supported CLI/database contract and Flatpak portal behavior are
   documented and fixture-backed.
6. Add modding-tool discovery (LOOT, SKSE, xEdit, BodySlide, Nemesis/Pandora and similar tools) after
   game/prefix ownership is reliable; tools inherit a confirmed game context rather than triggering
   a broad executable search.

### Cross-distribution compatibility strategy

Implement against capabilities and standards, not distribution-name conditionals. Distribution
identity may be reported for diagnostics and test selection, but runtime decisions should prefer XDG,
filesystem capability probes, package/sandbox metadata, portals, libc/runtime compatibility, and
available system services.

| Compatibility dimension | Required behavior                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Distribution families   | Ubuntu/Debian, Arch, Fedora, and openSUSE use the same discovery contracts. Distribution-specific adapters require documented evidence and must degrade safely when absent.                      |
| Immutable systems       | Detect read-only system areas and portal/container boundaries on Fedora Atomic variants and similar systems; keep mutable state in approved XDG locations. NixOS begins as experimental.         |
| Desktop/session         | GNOME and KDE Plasma under Wayland and X11 use portals/default-app mechanisms where available; headless or minimal sessions receive actionable fallbacks rather than assumptions about a GUI.    |
| Package formats         | Native packages, Flatpak, Snap, AppImage, and portable builds expose a normalized packaging context and visibility limits. No format is marked supported solely because its default path exists. |
| Runtime services        | Keyring, URI registration, file opening, process supervision, and notifications detect available implementations and expose safe fallback/error states. Do not require systemd for core logic.   |
| Filesystems/storage     | ext4, Btrfs, XFS, NTFS/exFAT, removable, and network mounts are selected by measured capabilities and mount metadata, not by distribution defaults.                                              |
| User configuration      | Honor `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, and `XDG_STATE_HOME`; preserve explicit user overrides and validate relocated launcher libraries/configuration.                      |
| libc/architecture       | Record glibc/musl and CPU architecture in diagnostics/build metadata. Treat musl and non-x86_64 targets as experimental until native dependencies and packaged smoke tests pass.                 |

### Verification matrix and support levels

The matrix grows in tiers so broad compatibility cannot hide regressions in the primary target.

| Tier         | Initial environments                                                                  | Release meaning                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary      | Ubuntu LTS + GNOME/Wayland; Arch + KDE Plasma/Wayland                                 | Required clean install, discovery, deployment, launch, restart, update, purge, rollback, and diagnostic smoke for a stable Linux release.           |
| Regular      | Debian stable, Fedora Workstation; representative X11 sessions                        | Required before claiming broad distribution support; failures block that environment's support label but do not silently change primary behavior.   |
| Packaging    | Native build plus each published Flatpak/Snap/AppImage format                         | Every distributed format has its own portal, URI, keyring, filesystem visibility, update, uninstall, and rollback evidence.                         |
| Experimental | openSUSE, Fedora Atomic variants, NixOS, musl-based distributions, non-x86_64 systems | “Expected to work” is insufficient: retain experimental status until maintainers can run and reproduce the same matrix on every advertised release. |

Repository and release documentation must distinguish **Supported**, **Tested**, **Expected to
work**, **Experimental**, and **Unsupported**. “Supported” requires a maintained owner, current
evidence, documented limitations, and a recovery path; popularity or one successful report is not
enough.

### Cross-distribution acceptance scenarios

- Discover the same Steam, Heroic, or Lutris library after relocating it through supported launcher
  settings or XDG variables, without adding a distribution-name special case.
- Deduplicate native/symlink/container views of the same physical resource while retaining its
  provenance and access boundary.
- Explain why a host-visible path is unavailable inside Flatpak/Snap and provide a minimal,
  user-approved remediation rather than changing permissions automatically.
- Select deployment methods from filesystem capabilities and preserve the previous deployment when
  a mount becomes read-only, unavailable, or changes identity.
- Launch through a structured native/Steam/Heroic/Lutris/Proton plan without shell concatenation and
  retain equivalent behavior on GNOME/KDE and Wayland/X11.
- Preserve settings, discovered resources, authentication state, profiles, and recovery journals
  across restart and package update.
- Cancel a long discovery pass promptly without leaving processes, watchers, temporary files, or
  partially updated cache state.
- Produce a privacy-safe diagnostic report sufficient to reproduce a distribution/package-specific
  failure without exposing usernames, tokens, or unrelated files.

### Scope guardrails

- Primary Linux workability, deployment safety, and recovery always take precedence over adding a
  new provider or distribution.
- Do not add heuristics that happen to work on one maintainer's machine without fixtures for missing,
  relocated, inaccessible, malformed, and duplicate resources.
- Do not execute discovered programs, import prefixes, grant sandbox permissions, remount storage,
  or edit system configuration without an explicit user action and exact preview.
- Do not claim full Linux compatibility. Publish the exact tested matrix and downgrade a support
  claim when its evidence cannot be maintained.
- Prefer a small set of reliable providers over many partially functioning integrations.

## Future feature opportunities

These are post-stable product opportunities, not requirements for the first stable Linux release.
Promote an item into the delivery roadmap only after product scope, security boundaries, ownership,
and measurable acceptance criteria are agreed.

### Game and launcher support

| Feature                              | User value                                                                                  | Key dependencies / constraints                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Heroic and Lutris library management | Discover, configure, and launch Epic/GOG games without manually entering paths or prefixes. | Stable launcher APIs/config formats, prefix ownership rules, and URI validation.                   |
| Bottles integration                  | Manage games and tools installed in Bottles with the correct runner and environment.        | Bottles CLI/API contract, sandbox portals, and explicit bottle selection.                          |
| Non-Steam Proton game support        | Add manually installed Windows games to the same runtime/deployment workflow.               | Explicit prefix/runtime ownership, executable trust checks, and no assumptions about Steam IDs.    |
| Per-tool runtime profiles            | Run LOOT, xEdit, BodySlide, Nemesis, and other tools with tool-specific overrides.          | Inheritance from the game profile, validation, and understandable fallback rules.                  |
| Launcher-option editor               | Configure Steam, Heroic, Lutris, Wine, and native launch arguments in one safe UI.          | Structured arguments, no shell concatenation, preview, validation, and reset-to-default.           |
| Compatibility database               | Share known-good game/runtime/deployment combinations and known limitations.                | Signed/versioned data, privacy policy, offline fallback, moderation, and reproducibility metadata. |
| Automatic game-extension suggestions | Recommend an extension or template when an unsupported game is discovered.                  | Reliable executable/store identity and a reviewed extension catalog.                               |

### Mod discovery and library experience

| Feature                     | User value                                                                                  | Key dependencies / constraints                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Native Nexus catalog        | Search, filter, inspect, and install mods without leaving Vortex.                           | Nexus API/product decision, authentication, rate limits, adult-content policy, and pagination.     |
| Download queue controls     | Pause, prioritize, schedule, throttle, and resume large collections.                        | Durable queue state, partial-file integrity, retry policy, and bandwidth controls.                 |
| Offline mod library         | Browse metadata, images, archives, and installation history without network access.         | Cache budget, invalidation, privacy, and explicit cleanup controls.                                |
| Duplicate archive detection | Avoid storing identical downloads under different names or sources.                         | Content hashing, safe deduplication, and clear ownership/reference counting.                       |
| Mod content preview         | Inspect archive structure, plugins, scripts, and conflicts before installation.             | Sandboxed parsing, decompression limits, malware-resistant preview, and large-archive performance. |
| Profile comparison          | Compare enabled mods, versions, rules, plugins, settings, and generated files side by side. | Stable profile snapshot schema and deterministic diff presentation.                                |
| Portable profile bundles    | Export/import a profile definition without embedding credentials or copyrighted archives.   | Signed manifest, source references, version policy, redaction, and missing-mod recovery.           |
| Collection dry run          | Show downloads, disk usage, conflicts, unsupported installers, and expected changes first.  | Deterministic install planning, metadata availability, and cancellable preflight.                  |

### Deployment and conflict management

| Feature                            | User value                                                                                       | Key dependencies / constraints                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Deployment dry-run preview         | Review every create, replace, backup, delete, and manifest change before applying it.            | Transaction plan must be authoritative and match execution exactly.                          |
| File-level conflict explorer       | Explain which mod wins each path and why, with filters for assets, plugins, and generated files. | Scalable conflict index, normalized paths, and provenance for merged/generated output.       |
| Selective file overrides           | Choose a winner for individual files without reordering entire mods.                             | Stable override rules, migration, validation, and clear interaction with installers/merges.  |
| Deployment snapshots               | Restore a previously committed deployment and settings state.                                    | Transactional recovery, content availability, storage budget, and schema migration.          |
| Content-addressed staging          | Deduplicate identical installed files and reduce storage usage across profiles.                  | Reference counting, crash-safe garbage collection, permissions, and filesystem capabilities. |
| Background deployment planning     | Calculate conflicts and expected writes while the user continues browsing.                       | Immutable state snapshot, cancellation, stale-plan invalidation, and bounded resource use.   |
| Configurable deployment exclusions | Protect user-selected files/directories from modification or purge.                              | Allowed-root validation, warnings for required files, and recovery semantics.                |
| Generated-file ownership tracking  | Attribute outputs from LOOT, Nemesis, BodySlide, FNIS, and similar tools to profiles/mods.       | Tool-specific output discovery, transaction integration, and external-change handling.       |

### Profiles, saves, and portability

| Feature                              | User value                                                                                | Key dependencies / constraints                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Save-game profile binding            | Automatically select or recommend the matching mod profile for a save.                    | Safe save metadata parsing, game-specific adapters, and ambiguity handling.                |
| Save backup and version history      | Recover from corrupt or incompatible saves.                                               | Atomic snapshots, retention policy, cloud-conflict handling, and user-controlled deletion. |
| Per-profile Proton prefix            | Isolate game settings, tools, and Windows dependencies between profiles.                  | Storage cost, Steam compatibility, prefix migration, and explicit lifecycle management.    |
| Profile health score                 | Summarize missing masters, unresolved conflicts, unsupported mods, and environment risks. | Explainable scoring; must never hide blocking details behind one number.                   |
| Cross-device profile sync            | Keep profile metadata consistent across Linux computers.                                  | End-to-end encryption, conflict resolution, schema migration, and no credential syncing.   |
| Import from other mod managers       | Migrate supported profiles from MO2 or other managers.                                    | Explicit format adapters, dry-run preview, provenance, and non-destructive import.         |
| Windows-to-Linux migration assistant | Convert paths, prefixes, tool settings, and deployment choices when moving systems.       | Path mapping, case-collision scan, unsupported-feature report, and rollback.               |

### Proton and compatibility tooling

| Feature                                  | User value                                                                      | Key dependencies / constraints                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Protontricks integration                 | Install and audit required Wine components for a game or tool.                  | Explicit user confirmation, prefix backup, verb allowlist, logs, and rollback guidance.     |
| Runtime download and management          | Install, update, pin, verify, and remove GE-Proton/custom runtimes from Vortex. | Trusted sources, signatures/checksums, atomic install, disk management, and license policy. |
| DLL and Wine-component diagnostics       | Explain missing runtime components before a tool fails.                         | Safe prefix inspection and a curated, versioned compatibility knowledge base.               |
| Prefix repair assistant                  | Detect common corrupt-prefix states and offer backup/rebuild workflows.         | Never mutate without backup/preview; distinguish Steam-owned and user-owned prefixes.       |
| Game-specific compatibility presets      | Apply reviewed environment variables and launch options for known games.        | Versioned signed presets, explicit diff/undo, and no silent overrides.                      |
| Proton version comparison                | Compare launch results and logs across selected runtimes.                       | Repeatable launch probes, privacy-safe log comparison, and user-controlled test scope.      |
| Shader-cache and prefix storage overview | Show disk use and safely open or clean known cache locations.                   | Ownership validation, Steam-running checks, preview, and recoverable cleanup.               |

### Automation and maintenance

| Feature                              | User value                                                                                | Key dependencies / constraints                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Scheduled update checks              | Check mods, collections, extensions, and runtimes on a user-selected schedule.            | Opt-in scheduling, rate limits, quiet hours, and no unattended destructive action.                |
| Configurable maintenance plans       | Preview and run cache cleanup, archive verification, metadata refresh, and health checks. | Transaction log, cancellation, storage estimates, and individually selectable actions.            |
| Automatic profile backup             | Periodically snapshot profile metadata and manifests.                                     | Retention, encryption, destination health, restore testing, and observable failures.              |
| Rules and load-order recommendations | Suggest conflict/load-order changes with a clear explanation.                             | Deterministic evidence, user approval, undo, and separation from authoritative LOOT metadata.     |
| Headless diagnostic command          | Run environment and profile checks from terminal or CI and emit JSON/Markdown.            | Stable versioned output schema, redaction, meaningful exit codes, and no GUI dependency.          |
| Scriptable extension test harness    | Let extension authors validate discovery, install, deploy, launch plan, and diagnostics.  | Sandboxed fixtures, deterministic APIs, documented contracts, and no real credentials by default. |

### Desktop integration and usability

| Feature                              | User value                                                                                | Key dependencies / constraints                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Desktop notifications                | Report completed downloads, deployment, tool exits, and required recovery actions.        | Portal support, quiet hours, actionable-notification safety, and notification preferences.   |
| System tray and background mode      | Keep downloads and approved maintenance running without an open window.                   | Clear lifecycle controls, resource limits, shutdown behavior, and desktop compatibility.     |
| Drag-and-drop mod installation       | Install local archives directly from supported file managers.                             | Portal-aware paths, archive validation, duplicate handling, and clear target-game selection. |
| Native file-manager integration      | Add safe “Install with Vortex” actions where supported.                                   | Desktop-specific packaging, explicit consent, quoting, and uninstall cleanup.                |
| First-class controller navigation    | Use core setup, profile, download, and deployment flows without mouse/keyboard switching. | Focus model, accessibility semantics, and automated navigation testing.                      |
| Theme and scaling validation         | Keep UI usable under fractional scaling, high DPI, dark themes, and large text.           | Wayland/X11/KDE/GNOME matrix and visual regression coverage.                                 |
| Contextual troubleshooting assistant | Turn a health finding into ordered checks and reversible fixes.                           | Local-first diagnostics, no automatic privileged commands, exact preview, and audit history. |

### Long-term Lotrex identity and redesign

This is a distant, post-stable product branch. It must not delay Linux workability, deployment
safety, recovery, localization, packaging, or the first evidence-backed release. A redesign is not a
single visual reskin: it needs its own scope, accessibility criteria, asset provenance, migration
plan, and regression budget.

| Phase | Redesign workstream                   | Status | Completion criteria                                                                                                                                                                                                                             |
| ----: | ------------------------------------- | :----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | Brand and asset inventory             |   —    | Inventory every inherited Vortex/Nexus name, logo, banner, icon, illustration, font, colour token, splash screen, installer image, tray icon, About screen, and packaged asset. Record its source, license, owner, and replacement requirement. |
|     2 | Independent Lotrex visual identity    |   —    | Create an original Lotrex logo, wordmark, icon family, colour direction, and compact monochrome variants that do not imply an official Nexus Mods release or closely imitate protected Vortex/Nexus branding.                                   |
|     3 | Branding replacement boundary         |   —    | Replace product-facing identity in the app shell, launcher, desktop files, installer, package metadata, notifications, protocol registration, diagnostics, screenshots, and release pages while retaining required legal attribution.           |
|     4 | UX research and workflow audit        |   —    | Map first run, game discovery, mod installation, deployment, conflicts, profiles, tools, diagnostics, and recovery. Identify measurable usability problems instead of redesigning solely for appearance.                                        |
|     5 | Information architecture              |   —    | Define navigation, page hierarchy, terminology, progressive disclosure, empty/error/loading states, and safe placement of destructive actions. Validate the structure with representative novice and experienced workflows.                     |
|     6 | Accessible design system              |   —    | Establish reusable components, typography, spacing, colour and focus tokens, motion rules, keyboard patterns, screen-reader contracts, scaling behavior, and light/dark themes meeting the selected WCAG target.                                |
|     7 | Incremental shell migration           |   —    | Migrate the application shell and shared controls behind reviewable boundaries without mixing visual work with deployment logic. Preserve a rollback path and prevent old/new component behavior from silently diverging.                       |
|     8 | Critical workflow redesign            |   —    | Redesign setup, discovery, deployment, conflicts, diagnostics, and recovery first. Every migrated workflow must retain data-safety warnings, exact previews, cancellation, error recovery, and existing keyboard capability.                    |
|     9 | Secondary workflow migration          |   —    | Migrate downloads, profiles, extensions, settings, tools, collections, and remaining screens only after critical journeys are stable and the component library is proven.                                                                       |
|    10 | Visual and interaction regression     |   —    | Add screenshot, keyboard-navigation, screen-reader, scaling, reduced-motion, localization-length, and GNOME/KDE Wayland/X11 coverage. Compare performance and memory against the pre-redesign baseline.                                         |
|    11 | Compatibility and extension migration |   —    | Document UI/API changes for extensions, provide a bounded compatibility layer or migration guide, version breaking changes, and avoid silently breaking third-party themes or integrations.                                                     |
|    12 | Redesign release and cleanup          |   —    | Run a separate preview cycle, resolve blocking accessibility/usability regressions, remove obsolete assets and compatibility code only after adoption evidence, and publish before/after scope plus known limitations.                          |

#### Typography redesign roadmap

This is a design investigation, not approval to add JetBrains Mono or replace the current Inter
family. The existing fonts remain unchanged until the redesign reaches an evidence-backed choice.

| Phase | Typography workstream              | Status | Completion criteria                                                                                                                                                                                                                    |
| ----: | ---------------------------------- | :----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 | Current typography inventory       |   —    | Record every bundled and system font, weight, style, fallback chain, usage location, package cost, source, copyright, and license. Identify legacy declarations and fonts that are shipped but unused.                                 |
|     2 | Linux-oriented candidate shortlist |   —    | Compare open fonts familiar in Linux and developer tooling communities. Consider Inter/Noto Sans for dense interface text and JetBrains Mono/Noto Sans Mono for commands, paths, logs, and diagnostics; treat all names as candidates. |
|     3 | Ukrainian and language coverage    |   —    | Verify every required weight contains complete Ukrainian Cyrillic (`Ґґ`, `Єє`, `Іі`, `Її`), apostrophes, punctuation, symbols, and other supported locale coverage without relying on mixed-font fallback.                             |
|     4 | Licensing and provenance           |   —    | Confirm redistribution and modification rights, preserve OFL or other required license files and notices, record exact upstream source and version, and reject fonts with unclear provenance.                                          |
|     5 | Role-based typography system       |   —    | Define separate tokens for body text, headings, compact controls, numerical data, commands, paths, logs, and code. Monospace fonts are limited to technical content unless usability testing supports broader use.                     |
|     6 | Cross-distribution rendering       |   —    | Compare bundled-font rendering on Ubuntu, Fedora, Arch-based systems, SteamOS, Flatpak, and AppImage across GNOME/KDE and Wayland/X11; ensure the result does not depend on host-installed fonts.                                      |
|     7 | Layout and accessibility QA        |   —    | Test English and long Ukrainian copy at 100%, 125%, 150%, and 200% scaling for clipping, wrapping, hierarchy, readability, focus visibility, screen readers, and low-resolution displays.                                              |
|     8 | Performance and package budget     |   —    | Measure startup/font-loading cost and package-size change; subset only when licensing permits and locale coverage is automatically verified. Remove redundant weights only after usage evidence.                                       |
|     9 | Incremental rollout and rollback   |   —    | Introduce typography through design tokens, migrate representative screens first, retain a simple rollback, collect screenshot and usability evidence, then expand without coupling the change to Linux runtime behavior.              |
|    10 | Final selection and documentation  |   —    | Record the chosen families, rejected alternatives, licenses, supported scripts, fallback policy, visual examples, known limitations, and contributor rules before making the typography the Lotrex default.                            |

Long-term redesign guardrails:

- Keep functional Linux stabilization and redesign commits separate whenever practical.
- Do not remove inherited attribution, copyright, or license notices when replacing visible branding.
- Do not publish generated artwork without confirming training/input rights and output provenance.
- Prefer original assets or clearly compatible open licenses; store editable sources and license metadata.
- Avoid a “big bang” rewrite. Ship small reversible migrations with equivalent recovery behavior.
- Treat accessibility, localization, performance, and extension compatibility as acceptance work,
  not cleanup after the visual design is finished.

### Privacy, security, and trust

| Feature                           | User value                                                                                | Key dependencies / constraints                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Diagnostic consent dashboard      | Show exactly what telemetry, crash, and support data can leave the device.                | Default-minimal collection, per-category consent, preview, retention, and deletion controls.      |
| Extension permission declarations | Explain filesystem, network, process, credential, and protocol access before enablement.  | Enforceable sandbox/capability model, signed manifests, migration, and revocation.                |
| Extension trust and signature UI  | Distinguish bundled, verified, signed third-party, local-development, and modified code.  | Signature infrastructure, provenance, key rotation, and understandable warnings.                  |
| Sandboxed installer analysis      | Inspect untrusted installer logic with constrained filesystem/process/network access.     | OS sandbox support, IPC schema, resource limits, and secure fallback when unavailable.            |
| Local security audit export       | Produce a redacted record of runtimes, permissions, extensions, protocols, and paths.     | Stable schema, exact preview, sensitive-field classification, and user-controlled export.         |
| Credential health and rotation    | Detect unavailable keyring, undecryptable secrets, expired tokens, and required re-login. | No secret exposure, provider-specific lifecycle, actionable recovery, and packaged keyring tests. |

## Future-feature prioritization rubric

Score candidates before promotion into an active milestone.

| Criterion                    | Weight | Question                                                                                      |
| ---------------------------- | :----: | --------------------------------------------------------------------------------------------- |
| Data-loss and recovery value |   5    | Does this prevent or recover user data loss?                                                  |
| Daily workflow value         |   4    | How often does it reduce manual work for supported users?                                     |
| Compatibility reach          |   4    | How many games, stores, desktops, or deployment methods benefit?                              |
| Security and privacy impact  |   4    | Does it reduce trust-boundary risk or improve informed consent?                               |
| Testability                  |   3    | Can acceptance be deterministic without credentials, proprietary services, or hardware?       |
| Maintenance cost             |   -3   | How much ongoing adaptation to external formats/services is required?                         |
| Platform fragility           |   -3   | How dependent is it on desktop portals, native modules, Wine internals, or undocumented APIs? |

Prefer features with strong recovery/daily-use value, broad reuse, explicit ownership, reversible
behavior, and deterministic tests. Defer features that expand privileged execution or external
service dependence until their trust and maintenance model is clear.

## Public Git fork publication track

The public fork should prioritize a small, dependable Linux experience over a large feature list.
No capability may be advertised as supported until its critical workflow is repeatable, its known
limitations are documented, and failures preserve user data or provide a recovery path.

| Phase | Publication work                          | Status  | Completion criteria                                                                                                                                                                                                                                                                                                                                                |
| ----: | ----------------------------------------- | :-----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|     1 | Stabilize the release scope               |    —    | Select the first supported games, stores, deployment methods, and package formats. Move incomplete or unreliable features behind an experimental label or exclude them from the first release. Define the blocking smoke matrix and known limitations.                                                                                                             |
|     2 | Credit the base fork                      | Partial | README prominently credits and links `Starkka15/Vortex` and Nexus Mods Vortex, explains inherited history/contributors, and distinguishes maintenance. Add the same attribution to the repository description and future release notes.                                                                                                                            |
|     3 | Preserve the same license                 | Partial | The existing `LICENSE.md`, history, and source notices remain, and README identifies GPL-3.0. Packaged-artifact notices and the bundled/vendor provenance review remain.                                                                                                                                                                                           |
|     4 | Develop the project description           | Partial | README now covers purpose, Linux-first value, lineage, current evidence-based status, lack of downloads, limitations, development, privacy guidance, contribution expectations, upstream policy, and license. Add screenshots, final installation/first-run guidance, troubleshooting, and a concise GitHub About description when releases exist.                 |
|     5 | Choose identity without misleading users  | Partial | The repository and README use the distinct Lotrex name and state that it is independent and unofficial. Icon/branding, version suffix, trademark review, and precise compatibility claims remain.                                                                                                                                                                  |
|     6 | Prepare reproducible public builds        |    —    | Produce documented builds from a clean checkout, record dependency and toolchain versions, generate checksums, include all required licenses, and verify install, update, uninstall, and rollback behavior for each published package format.                                                                                                                      |
|     7 | Clean the public repository               |    —    | Remove credentials, private paths, local artifacts, temporary diagnostics, test accounts, and environment-specific configuration. Add contribution, issue, security-reporting, code-of-conduct, and support-scope documents. Confirm that history contains no sensitive material before pushing.                                                                   |
|     8 | Publish a pre-release                     |    —    | Push the fork and tags to the selected Git host, publish a clearly marked alpha/beta release, include changelog and known issues, and ask a small Linux testing group to exercise only the declared support matrix. Do not present deferred manual checks as completed.                                                                                            |
|     9 | Establish maintenance and upstream policy |    —    | Document how updates from `Starkka15/Vortex` and upstream Vortex will be reviewed and merged, how regressions are handled, how releases are versioned, and which features can be deprecated when they cannot be maintained reliably.                                                                                                                               |
|    10 | Audit ownership and legal provenance      |    —    | List code, images, fonts, game artwork, binaries, translations, copied snippets, and generated files that did not originate in this fork. Confirm that each item may be redistributed under compatible terms, retain its notices, and remove or replace anything with unclear permission. Do not assume that public availability means permission to republish.    |
|    11 | Scan secrets and full Git history         |    —    | Check the current tree, ignored files, previous commits, tags, large objects, CI logs, examples, screenshots, crash dumps, and configuration for tokens, cookies, passwords, private keys, email addresses, usernames, machine paths, and personal data. Revoke exposed credentials before rewriting history; deleting a file in a later commit is not sufficient. |
|    12 | Add repository hygiene files              |    —    | Review `.gitignore`, `.gitattributes`, line endings, executable bits, generated-file policy, binary/LFS policy, editor settings, and the files included in source archives. Ensure a clean clone can build without untracked local files and that generated outputs do not create noisy diffs.                                                                     |
|    13 | Create contributor and community guidance |    —    | Add `CONTRIBUTING.md`, a code of conduct, development setup, test commands, formatting rules, commit/PR expectations, translation guidance, and a statement of which contributions are currently in scope. Keep instructions short enough for a first-time contributor to follow from a clean clone.                                                               |
|    14 | Configure issues and discussions          |    —    | Add bug, feature, game-support, and compatibility-report templates that request version, package format, distribution, desktop session, game/store/runtime, reproduction steps, logs with a privacy warning, and expected/actual behavior. Configure labels, duplicate handling, support boundaries, and a place for questions that are not actionable bugs.       |
|    15 | Publish a security policy                 |    —    | Add `SECURITY.md` with supported versions, a private reporting route, expected response scope, guidance not to publish credentials or weaponized exploits, and a disclosure process. Enable dependency and secret alerts where available; never promise response times that cannot realistically be maintained.                                                    |
|    16 | Establish CI and protected release gates  |    —    | Run format, lint, typecheck, tests, build, license/secret checks, and a minimal Linux smoke job on clean pull requests. Pin or review third-party CI actions, use least-privilege tokens, prevent untrusted pull requests from accessing release secrets, protect the release branch, and require successful checks before creating a release artifact.            |
|    17 | Define versions, changelog, and releases  |    —    | Choose a documented version scheme, maintain `CHANGELOG.md`, distinguish alpha/beta/stable builds, use annotated tags, publish checksums and installation/rollback instructions, identify the exact commit used, and keep old known-good releases available unless a security or legal reason requires withdrawal.                                                 |
|    18 | Plan dependency and vulnerability upkeep  |    —    | Enable reviewed dependency update proposals, record the package-manager and lockfile policy, monitor security advisories, define how quickly critical issues disable affected downloads, and periodically verify that clean builds remain reproducible. Dependency bots must open reviewable pull requests rather than merging broad upgrades automatically.       |
|    19 | Protect project administration            |    —    | Enable multi-factor authentication, store recovery codes safely, avoid sharing personal access tokens, use narrowly scoped release credentials, configure branch/tag protection, keep at least one offline backup or mirror, and document how maintainership can be transferred if the original maintainer becomes unavailable.                                    |
|    20 | Prepare support expectations              |    —    | State that the project is community-maintained, which distributions/games/package versions receive support, what diagnostic information is safe to share, what is best-effort only, and when issues may be closed. Provide a visible disclaimer that users should back up profiles, saves, and staging data before testing pre-releases.                           |

Public README status: **Partial**. The inherited official Vortex landing page has been replaced with
a Lotrex-specific README that clearly identifies the project as an unofficial, community-maintained
Linux-focused fork, credits both upstream layers, explains inherited contributors, warns that no
supported download exists, reports only evidence-backed status, links this roadmap, and retains the
GPL-3.0 license reference. Repository About text, screenshots, release installation instructions,
support documents, branding review, and packaged legal notices remain.

### Minimum public repository files

Before the first public announcement, review or add the following files. Templates must describe
this project specifically rather than being copied without review.

| File or setting                           | Purpose                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                               | What the project is, who it is for, base-fork attribution, supported status, installation, screenshots, limitations, and basic usage.    |
| `LICENSE.md`                              | The unchanged GNU GPL v3 license used by the base fork, plus any required notices outside the license text.                              |
| `NOTICE` or third-party notices           | Attribution and license information for bundled dependencies, artwork, native binaries, and vendor files when their licenses require it. |
| `CHANGELOG.md`                            | User-visible changes, fixes, breaking changes, migrations, and known issues for each release.                                            |
| `CONTRIBUTING.md`                         | Clean-clone setup, repository commands, PR rules, testing expectations, and contribution scope.                                          |
| `SECURITY.md`                             | Supported versions and a private, safe method for reporting vulnerabilities.                                                             |
| Code of conduct                           | Expected community behavior and moderation scope.                                                                                        |
| Issue and pull-request templates          | Structured reports with privacy guidance and a repeatable reviewer checklist.                                                            |
| CI workflows and branch rules             | Required checks, restricted secrets, protected release tags/branches, and reproducible artifact creation.                                |
| Repository topics, description, and links | A short honest summary, Linux/modding discoverability, documentation link, and no implication of official Nexus Mods ownership.          |

### Safe first-publication sequence

1. Decide the name, owner account or organization, support scope, and whether source-only or binary
   releases will be offered.
2. Verify ownership, GPL v3 obligations, third-party notices, trademarks, and permission for every
   redistributed asset or binary.
3. Scan secrets and personal data across the complete Git history, revoke anything exposed, and
   rewrite history only after making a recoverable backup.
4. Create a clean private mirror and verify clone, install, test, build, package, and uninstall using
   only documented commands.
5. Finish README, attribution, license/notices, support matrix, security policy, contribution guide,
   changelog, and issue templates.
6. Configure least-privilege CI, branch protection, two-factor authentication, release signing or
   checksums, and backup access.
7. Open the source repository first, inspect the public result from a logged-out browser, and correct
   links, accidental files, permissions, and misleading descriptions.
8. Publish binaries only from a tagged, reproducible commit after the source-only review is clean.
9. Start with a clearly labelled pre-release and a small tester group; expand support only after
   repeated evidence, not based on planned roadmap entries.

Initial publication acceptance requires phases 1–4 and 7 to be complete, the same license to be
present in source and artifacts, attribution to `Starkka15/Vortex` to be visible without searching,
and every advertised workflow to pass the release smoke matrix. Phases 10–16 and 19 are also required
before accepting outside contributors. Public binaries additionally require phases 6, 17, and 18;
the first announced testing release requires phases 8 and 20.
