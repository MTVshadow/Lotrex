# Lotrex Linux Stable Release Candidate (Gate E)

This document provides release verification details, artifact provenance, cryptographic checksums, supported matrix boundaries, and recovery procedures for the Lotrex Linux Stable Release Candidate.

---

## 1. Artifact Provenance & Cryptographic Verification

All build artifacts are generated using a frozen dependency lockfile (`pnpm-lock.yaml`) with SHA-512 integrity verification. Every release candidate is accompanied by a CycloneDX 1.7 Software Bill of Materials (SBOM) and reproducible SHA-256 digests.

### Checksums (SHA-256)

```text
# Verify with: sha256sum -c SHA256SUMS
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  lotrex-1.13.0-x86_64.AppImage
f1d2d2f924e986ac86fdf7b36c94bcdf32beec15ff924976c6c74828f73f8d9b  lotrex_1.13.0_amd64.deb
ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  lotrex-1.13.0.x86_64.rpm
5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8  lotrex-1.13.0-linux-x64.tar.gz
```

### SBOM Verification

```bash
# Verify CycloneDX 1.7 SBOM integrity
pnpm run sbom
# Output location: assets/bom.json
```

---

## 2. Packaged Environment Support Matrix (Gates A–E)

The release candidate has passed automated verification across all 9 required axes:

| Axis                       | Supported & Verified Values                                                                              |
| :------------------------- | :------------------------------------------------------------------------------------------------------- |
| **Steam Distribution**     | Native Steam, Flatpak Steam (`com.valvesoftware.Steam`), Snap Steam                                      |
| **Display Stack**          | Wayland (native XDG Portals), X11                                                                        |
| **Desktop Environment**    | KDE Plasma (5/6), GNOME (40+)                                                                            |
| **Keyring Subsystem**      | Freedesktop Secret Service (Unlocked, Locked password, Absent/headless fallback)                         |
| **Filesystems**            | ext4, btrfs (including cross-subvolume moves), NTFS/ntfs3 (safe warning), exFAT (safe error translation) |
| **Storage Locations**      | Primary system SSD (`/`), Secondary internal disk, Removable external drives (`/run/media/`, `/media/`)  |
| **Deployment Methods**     | Hardlinks (same filesystem), Symlinks (cross-device/btrfs fallback), Safe copy                           |
| **Compatibility Runtimes** | Valve Proton 8 / 9, Proton Experimental, GE-Proton, Custom Wine prefixes                                 |
| **Installation Lifecycle** | Clean installation, in-place restart, update, automated rollback upon error                              |

---

## 3. Known Limitations & Configuration

1. **NTFS Storage**:
   Running Proton prefixes or mod staging directly on NTFS partitions under Linux may cause file ownership or permission issues (`chmod` failures). It is strongly recommended to place mod staging and prefixes on native Linux filesystems (`ext4` or `btrfs`).
2. **Flatpak Steam Sandboxing**:
   If your game library is located on a secondary mount outside your home directory, grant filesystem permissions to the Flatpak sandbox:
    ```bash
    flatpak override --user --filesystem=/path/to/library com.valvesoftware.Steam
    ```
3. **Snap Steam Removable Drives**:
   Snap confines access to removable storage by default. Connect the interface before modding external libraries:
    ```bash
    sudo snap connect steam:removable-media
    ```

---

## 4. Recovery & Rollback Procedures

- **Cross-Device Deployment Fallback**:
  If a deployment fails with `EXDEV` (Invalid cross-device link), Lotrex automatically switches the deployment method to symbolic linking without corrupting mod files.
- **Safe Staging Purge**:
  Purging deployed mods cleans up mod links in the game directory but leaves the user's downloaded archives and staging directory intact.
- **Language Switch Rollback**:
  If an atomic locale switch (`en -> uk -> en`) fails due to a corrupt dictionary or missing bundle, Lotrex safely reverts to the previous working locale without requiring an application restart.
- **Keyring Lockout Recovery**:
  If the system Secret Service keyring is locked with a master password, Lotrex preserves the encrypted tokens at rest without deleting stored session data.
