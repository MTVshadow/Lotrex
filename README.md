# Lotrex

**A community-maintained, Linux-focused fork of Vortex Mod Manager.**

Lotrex explores a dependable and convenient Vortex experience for modded games on Linux. Its first
priority is not adding as many features as possible: it is making core discovery, deployment,
launching, diagnostics, and recovery behave safely and predictably across real Linux systems.

> [!WARNING]
> Lotrex is under active development. It is not yet a stable release, no end-user build is currently
> published, and several important packaged-app and real-game tests remain incomplete. Back up game
> saves, profiles, downloads, and staging data before testing development builds.

Lotrex is an independent community project. It is **not an official Nexus Mods product** and is not
endorsed or supported by Nexus Mods.

## Project lineage and credit

Lotrex is maintained by [MTVshadow](https://github.com/MTVshadow) and is based on
[Starkka15/Vortex](https://github.com/Starkka15/Vortex), which itself derives from the official
[Nexus Mods Vortex](https://github.com/Nexus-Mods/Vortex) project.

The full inherited Git history is intentionally preserved. Consequently, GitHub's Contributors page
includes authors from Vortex and the base fork. Their presence records authorship of inherited work;
it does not mean they maintain, endorse, or provide support for Lotrex.

## What Lotrex changes

Current development focuses on the Linux-specific layers around the existing Vortex experience:

- Native, Flatpak, and Snap-aware Steam discovery, including external Steam libraries.
- Proton runtime, prefix, Windows-user, and modding-tool discovery.
- Structured launch plans for native games, Steam, Proton, Heroic, and Lutris integrations.
- Linux filesystem checks for hardlinks, symbolic links, cross-device moves, permissions, available
  capacity, read-only mounts, NTFS/exFAT, and network filesystems.
- Deployment journals, interruption detection, guarded recovery, and rollback-oriented failure
  handling.
- Case-insensitive Windows-path collision detection on case-sensitive Linux filesystems.
- Bounded discovery caches, cancellation, progress reporting, and scale benchmarks.
- Linux-focused Health Check diagnostics with privacy-safe reports.
- Ongoing keyboard and screen-reader improvements for Linux setup, diagnostics, and recovery.

Detailed implementation evidence, deferred checks, and future work are tracked in
[LINUX-ROADMAP.md](./LINUX-ROADMAP.md).

## Current status

| Area                       | Current state                                                                |
| -------------------------- | ---------------------------------------------------------------------------- |
| Source development         | Active                                                                       |
| Stable end-user release    | Not available                                                                |
| Packaged Linux builds      | Not yet published                                                            |
| Steam and Proton discovery | Implemented; additional packaged smoke testing remains                       |
| Heroic discovery           | Partial                                                                      |
| Lutris discovery           | Partial; some installations require the planned read-only database provider  |
| Linux deployment safety    | Substantial implementation; real-filesystem and interruption matrices remain |
| Ukrainian localization     | Planned; language selector and complete translation are not implemented yet  |
| Broad distribution support | Not claimed                                                                  |

Ubuntu and Arch-based environments are the initial development targets, but neither should be
interpreted as fully supported until the release gates and packaged smoke matrix in the roadmap are
complete. Other distributions and packaging formats remain expected, experimental, or unsupported
until they have repeatable evidence.

## No downloads yet

There is currently no supported Lotrex installer or release artifact. The repository contains
development source code only. Do not download an archive from GitHub's **Code** button expecting it
to be a ready-to-run application.

When the first testing release is ready, it will be published on this repository's Releases page
with:

- an explicit alpha or beta label;
- supported and experimental environment details;
- checksums and build information;
- known limitations;
- installation, update, uninstall, and rollback instructions.

## Development

The project currently uses Node.js `24.17.0` and pnpm `11.10.0`. From a clean checkout:

```bash
corepack enable
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

Some test and packaging paths are platform-specific. A successful source build alone does not prove
that a packaged Linux application or a particular game workflow is supported.

Useful Linux benchmarks are available as explicit opt-in commands:

```bash
pnpm run benchmark:linux-deployment
pnpm run benchmark:linux-discovery
pnpm run benchmark:linux-case-collisions
```

The deployment benchmark creates many temporary files. Review its options and ensure sufficient
temporary storage before running large cases.

## Contributing and testing

Contributions are welcome, especially when they include a reproducible Linux environment, focused
fixtures, and clear failure/recovery evidence. Before opening a change:

1. Check the roadmap and existing issues.
2. Describe the distribution, desktop session, package format, launcher, filesystem, and relevant
   game setup.
3. Avoid publishing access tokens, usernames, full home-directory paths, or unrelated logs.
4. Include a safe reproduction and explain whether real game, prefix, staging, or save data is at
   risk.
5. Do not mark a platform or workflow supported based on a single successful run.

Contributor, issue, security-reporting, and support-scope documents are still being prepared. Until
then, treat the repository as an early development project rather than a user-support channel.

## Relationship with upstream projects

Lotrex keeps the base fork configured as an upstream source so inherited fixes can be reviewed and
integrated deliberately. Linux-specific changes may differ from the direction or support policy of
the base fork and official Vortex.

For official Vortex downloads, documentation, or support, use the official Nexus Mods resources:

- [Vortex source repository](https://github.com/Nexus-Mods/Vortex)
- [Vortex on Nexus Mods](https://www.nexusmods.com/site/mods/1)
- [Vortex documentation](https://wiki.nexusmods.com/index.php/Vortex)

Please do not report Lotrex-specific defects to Nexus Mods or to the maintainers of the base fork
unless the problem has been independently reproduced in their unmodified project.

## License

Lotrex is distributed under the same [GNU General Public License v3.0](./LICENSE.md) used by the
inherited project. Existing copyright, authorship, license notices, and Git history are preserved.

The Lotrex name identifies this independent fork; it does not replace the copyright or authorship of
the software from which it is derived.
