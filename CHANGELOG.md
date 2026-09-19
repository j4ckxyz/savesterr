# Changelog

## 1.1.0

- Renamed to **savesterr**: the command, release files, installers, environment variables (`SAVESTERR_*`) and repository.
- Settings from `songsterr-pdf` are migrated automatically on first run.
- Install instructions use the GitHub CLI, since the repository is private.

## 1.0.1

- Fix: macOS binaries now carry a valid code signature. Bun's embedded app bundle invalidated the original ad-hoc signature, so releases are now re-signed with the JIT entitlements Bun recommends.
- Fix: the installer now checks that musl systems (Alpine) have `libstdc++`/`libgcc` and tells you how to install them.
- Documented tested support floors: glibc 2.17 (CentOS 7) and Alpine 3.17.

## 1.0.0

- First release as an installable app for macOS, Windows and Linux (x64 + ARM64, glibc + musl).
- App mode: search or paste a link → pick parts → PDFs open; "What next?" menu; settings.
- `songsterr-pdf update`, plus a daily update check that offers to update at launch.
- US Letter paper, combined PDFs with bookmarks, Windows-safe file names.
- One-line installers for macOS/Linux (`sh`) and Windows (PowerShell 5.1 and 7).
