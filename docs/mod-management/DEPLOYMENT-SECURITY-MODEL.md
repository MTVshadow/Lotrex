# Deployment Security & Ownership Model (Linux TOCTOU Remediation)

## 1. Threat Model & Attacker Capabilities

In Linux desktop environments, Vortex/Lotrex runs with the permissions of the current unprivileged user. Games may be installed in various locations:

- User home directory (`~/.local/share/Steam/...`)
- Secondary internal mounts (e.g. `/mnt/games`, `/data`)
- Shared multi-user or external removable drives (`/media/...`, `/run/media/...`)

### Attacker Definition

The threat model considers a concurrent, unprivileged local actor (another process or user sharing write permissions to a parent directory) with the ability to:

1. Observe filesystem operations and directory names.
2. Alter directory hierarchies between the time Vortex checks path safety and the time Vortex creates, links, renames, or unlinks files (Time-of-Check to Time-of-Use / TOCTOU race condition).
3. Swap a legitimate destination directory with a symbolic link pointing to sensitive host directories (e.g., `~/.ssh`, `/etc`, or browser session stores).

---

## 2. Invariants & Safety Constraints

To eliminate TOCTOU race conditions and prevent privilege escalation or arbitrary file corruption, the following invariants are enforced across method selection, health checks, and linking deployment:

### Invariant 1: Root Containment & Ancestor Symlink Ban

- All target files must reside strictly within the declared `dataPath`. Lexical traversal (`../`) and canonical symlink escapes are rejected immediately with `EDEPLOYMENTOUTSIDEROOT`.
- Every ancestor directory between `dataPath` and the immediate parent directory must be a genuine POSIX directory. If any ancestor is a symbolic link, deployment fails with `EDEPLOYMENTSYMLINK`.

### Invariant 2: Directory Ownership & Permission Policy

- The destination parent directory must be owned by either the current user (`process.getuid()`) or `root` (UID 0).
- **World-writable directories** (`mode & 0o002 !== 0`) are strictly forbidden unless the sticky bit (`0o1000`) is active (similar to `/tmp`). A world-writable directory without sticky bit allows arbitrary users to remove or replace files, which violates integrity. Violation raises `EDEPLOYMENTUNSAFEPERMISSIONS`.
- **Group-writable directories** (`mode & 0o020 !== 0`) are rejected if the group does not match the current process primary or supplemental GID.

### Invariant 3: Descriptor-Bound Mutation Boundary

- Pathname-based mutations (`fs.link`, `fs.symlink`, `fs.rename`, `fs.unlink`) on raw strings are forbidden on Linux deployment sinks.
- All deployment mutations (backup creation, link creation, backup restore, unlinking) must operate through an open file descriptor referencing the validated parent directory via `/proc/self/fd/<fd>/<basename>`.
- Even if a concurrent actor replaces the directory path on disk after validation, operations bound to the existing directory file descriptor remain locked to the validated inode and cannot escape into attacker-controlled targets.

### Invariant 4: Special Device File Rejection

- Sockets, FIFOs (named pipes), character devices, and block devices are never written, linked, or unlinked. Any attempt to target a special device aborts with `EDEPLOYMENTSPECIALDEVICE`.
