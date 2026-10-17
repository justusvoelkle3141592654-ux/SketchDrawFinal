# Canvas Forge installer for Windows

> This is the first build (0.1.0), kept for reference. Newer installers are built by GitHub Actions; see *Install* in the main [README](../README.md).

`Canvas Forge Setup 0.1.0.exe` installs Canvas Forge as a regular Windows application (x64, Windows 10/11).

* Size: 96 966 197 bytes
* SHA-256: `91c6e08e9739ce8d982fee377cc5feb6a17b316c078c6a9d8087210aed2e3d55`
* Built with `npm run package:win` from this repository.

## Install

1. Download `Canvas Forge Setup 0.1.0.exe` (on GitHub: open the file and use the download button).
2. Run it. The installer is not code-signed, so Windows SmartScreen may warn: choose **More info** → **Run anyway**.
3. Choose whether to install for yourself only (no administrator rights needed) or for all users, optionally change the folder, then install.

The installer:

* installs the app (per user: `%LOCALAPPDATA%\Programs\Canvas Forge`),
* creates a Start menu and a desktop shortcut,
* registers `.cforge` documents so they open in Canvas Forge,
* adds Canvas Forge to the installed apps in **Settings → Apps**, where it can be uninstalled.

## Uninstall

**Settings → Apps** → Canvas Forge → **Uninstall** (or run `Uninstall Canvas Forge.exe` in the installation folder). Your documents are not touched.
