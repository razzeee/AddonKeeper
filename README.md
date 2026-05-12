# AddonKeeper

A cross-platform desktop app for keeping your [Ascension WoW](https://ascension.gg) addons up to date. Addons are sourced from GitHub — the app detects sources automatically from `.toc` metadata, or you can set them manually.

## Features

- **Auto-detect sources** — scans `.toc` files for `X-GitHub-Repository`, `X-Website`, and similar fields
- **TOC version comparison** — fetches the remote `.toc` file and compares `## Version:` fields directly, no SHA confusion
- **Git repo support** — if an addon folder is a git repository, updates use `git pull` instead of downloading a zip
- **Install new addons** — paste a GitHub URL or `owner/repo` slug to download and install an addon from scratch
- **Pin addons** — prevent specific addons from being checked or updated
- **Bulk actions** — check or update all addons (or a selection) in one click
- **Cross-platform** — Linux (AppImage), Windows (NSIS installer), macOS (DMG)

## Download

Grab the latest release for your platform from the [Releases](../../releases) page.

| Platform | Format |
|----------|--------|
| Linux | `.AppImage` |
| Windows | `.exe` (NSIS installer) |
| macOS | `.dmg` |

## Getting started

1. Launch the app
2. Click **Select AddOns folder** and navigate to your Ascension AddOns directory

   Default location on Linux (Steam/Proton):
   ```
   ~/.local/share/Steam/steamapps/compatdata/<appid>/pfx/drive_c/Program Files/Ascension Launcher/resources/ascension-live/Interface/AddOns
   ```
3. The app scans all addon folders and auto-detects GitHub sources where possible
4. For addons without a detected source, click ✏️ to set one manually
5. Click **Check all** to see what's out of date, then **Update** to apply

## How source detection works

Each addon's `.toc` file is scanned for these fields (in order):

```
## X-GitHub-Repository: owner/repo
## X-GitHub:            https://github.com/owner/repo
## X-Website:           https://github.com/owner/repo
## X-URL:               https://github.com/owner/repo
```

If none are found the addon shows "No source" — click ✏️ to set a GitHub URL manually. Sources are saved to the app's config file and persist across restarts.

## How version checking works

| Addon type | Local version | Remote version |
|---|---|---|
| Git repo (has `.git` folder) | `git rev-parse --short HEAD` | `git ls-remote origin HEAD` |
| GitHub source (no local git) | `## Version:` from local `.toc` | `## Version:` from remote `.toc` on GitHub |

Versions are only considered a match when they are identical strings, so a `3.3.5` TOC version is correctly compared to the `3.3.5` on the remote — not to a commit SHA.

## Development

**Requirements:** Node 22+, Git

```bash
git clone https://github.com/your-org/addonkeeper
cd addonkeeper
npm install
npm run dev
```

This starts the Vite dev server and opens Electron with hot reload.

### Build

```bash
# Current platform
npm run build

# Specific platforms
npm run build:linux   # AppImage
npm run build:win     # NSIS .exe
npm run build:mac     # DMG
```

Output goes to `dist-electron/`.

## Releasing

The GitHub Actions release pipeline triggers on version tags:

```bash
git tag v1.2.3
git push origin v1.2.3
```

This builds all three platform artifacts in parallel and publishes a GitHub Release with auto-generated release notes. Tags containing a `-` (e.g. `v1.2.0-beta.1`) are marked as pre-releases.

## Tech stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) — UI
- [Vite](https://vite.dev/) — bundler
- [lucide-react](https://lucide.dev/) — icons
- [electron-builder](https://www.electron.build/) — packaging
