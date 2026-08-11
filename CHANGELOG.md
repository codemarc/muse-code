# Changelog

## [0.1.11] - 2026-08-11

### Added

- View title buttons: open Muse Code website and Meta AI billing

## [0.1.10] - 2026-08-11

### Added

- Readable tool output cards for muse exec shell results: command, exit code, and stdout in a terminal-style view
- `muse.toolOutputFormat` setting (`readable` default, or `json`); each tool card can toggle Readable / Raw
- Clickable URLs and local file paths (including `.html`) in tool output; opens in the system browser or editor

## [0.1.9] - 2026-08-11

### Changed

- New icon: Meta AI ring geometry (from `Meta AI Logo (Ring Only).svg`) with gradient `#0179ec → #5ffac1 → #005fe3 → #ec7dd9`, centered teal M-wave — `media/icon.png` (128×128, ring `r42` centered at `64,64`, no wordmark) and `media/muse.svg` activityBar (ring `r9` at `12,12` centered to fill `24×24`, M centered inside, `currentColor`)

## [0.1.8] - 2026-08-10

### Added

- Session history: resume retained Muse sessions for the current folder (Quick Pick + History button)
- Hydrate the sidebar from Muse’s session log / `muse export` (source of truth), with a local transcript cache for snappy open
- Command: **Muse CLI Chat: Resume Session**

## [0.1.7] - 2026-08-10

### Fixed

- Extension Development Host (F5) uses `bun: compile` / `bun: watch` instead of `npm: compile`

## [0.1.6] - 2026-08-10

### Added

- GitHub Actions CI (`bun` test, typecheck, vsce package)
- `SECURITY.md` and `PRIVACY.md` for vulnerability reporting and data-flow disclosure

## [0.1.5] - 2026-08-10

### Fixed

- Setup no longer reports ready on `muse --version` alone; probes `META_API_KEY`, stored `~/.config/muse/auth.json`, or echo provider

## [0.1.4] - 2026-08-10

### Fixed

- Multi-root workspaces: pick and remember a folder (Quick Pick + view title command); no longer always uses the first root

## [0.1.3] - 2026-08-10

### Fixed

- Preflight rejects symlink / reparse-point workspace roots with a clear fix (setup banner + before send / interactive terminal)

## [0.1.2] - 2026-08-10

### Security

- Launch interactive Muse via `shellPath` (no `sendText` shell injection)
- Application-scope `executablePath`, `extraArgs`, `yolo`, and `disableApproval`
- Block `--yolo` / `--disable-sandbox` smuggled through `extraArgs`
- Harden binary resolution: `"muse"` or an existing file path only
- Default `disableApproval` to false; modal consent on first headless send
- Declare `untrustedWorkspaces` / `virtualWorkspaces` unsupported

## [0.1.1] - 2026-08-10

### Changed

- Moved source to standalone repo [codemarc/muse-code](https://github.com/codemarc/muse-code) (no longer under `bltcore-com/tools`)

## [0.1.0] - 2026-08-07

### Added

- Sidebar chat that runs Meta Muse Code via `muse exec --json`
- Commands: open chat, send selection, new session, stop, interactive terminal, check installation
- Settings for model, reasoning effort, trust/approval posture, echo provider, and extra argv
- First-run setup banner when the Muse CLI is missing or the platform is unsupported
- Unofficial-wrapper branding suitable for public Marketplace / Open VSX packaging
