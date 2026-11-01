# Changelog

## 0.5.1 - 2026-11-01

### Added

- **`toolDisplay: minimal`:** dense static one-line tool rows with no chevron or success badge for long 50+ tool runs. Labels prefer descriptions, tool names, and commands over raw output; runs with nothing sensible to show print nothing and collapse to a `working…` pulse every five tools. Failed calls keep the red badge and stay expandable
- **Default shortcut for the editor panel:** `Muse CLI Chat: Open in Editor Panel` is now on `⌘⇧R` (macOS) / `Ctrl+Shift+R` (Linux). The chord is unused by VS Code/Cursor defaults and verified against installed extensions; rebind it in Keyboard Shortcuts if it ever collides
- **Sidebar toolbar button for the editor panel:** one click pops the chat out into an editor tab, next to the History/New/Stop actions
- **Context attachments:** `@` picks and the new **+ Attach** menu add Cursor-style context chips (file contents, current file, open editors, Problems/diagnostics, terminal output). Chips expand inline into the `muse exec` prompt so the model sees contents without a re-read round trip; the sidebar keeps the compact prompt with chips
- Terminal output is captured via shell integration after activation (VS Code exposes no buffer-read API for output that predates the tap)

### Changed

- `@` file picks no longer insert a bare `` `path` `` into the prompt text; they attach the file with contents as a removable chip
- Chat view lives in the activity bar on every host. Cursor rejects `secondarySidebar` view containers unconditionally (startup error + warning, views dumped into Explorer), so the 0.2.0 right-side placement is gone rather than shipping known-broken in Cursor
- Header folder indicator only shows with multiple workspace folders open (single-root already names the folder in the window title); the duplicate `Muse: Open Editor Tab` palette entry is hidden since it does the same thing as `Muse CLI Chat: Open in Editor Panel`

### Fixed

- Status bar item (`Muse <session> · <mode>`) now shows at startup like other agent extensions instead of only after first opening chat. The extension activates on `onStartupFinished`; activation stays cheap (no CLI spawn) and untrusted/virtual workspace guards still apply

## [0.2.0] - 2026-09-09

### Added

- **Execution modes:** 2.0 makes `headless` and `interactive` explicit. Headless native chat remains backed by `muse exec --json`; interactive mode uses the integrated Muse terminal for approvals and interactive input. MSP is reserved for a future host-backed mode.
- **File mentions:** type `@` in the prompt box to pick an open, git-changed, or workspace file. The path is inserted as `` `path` `` so Muse can read it. This is not Cursor-style attach-with-contents
- **Changed-file diffs:** after a turn, the sidebar lists files Muse changed in the working tree and opens the diff in canvas. Review only: files are already on disk. No accept/reject

## [0.1.19] - 2026-09-08

### Added

- **Open Muse.ai**: view title button, Command Palette entry, and a `muse.ai` link in the chat header. Copies the current Muse Code session (hydrated log / `muse export`) as markdown, then opens Meta's personal Muse app in the browser. Globe still opens Muse Code docs; this control is the consumer app
- Prompt box: **⌘Enter** (macOS) or **Ctrl+Enter** (Linux) sends. Enter inserts a newline.

## [0.1.18] - 2026-09-02

### Fixed

- Setup now treats Muse Code 1.0.x `auth.json` as ready when Meta OAuth is stored in the macOS Keychain (`storage: "keychain"`). The previous probe only looked for `access_token` / `api_key` in the file, so a valid `muse login` looked like a missing credential.

## [0.1.17] - 2026-08-21

### Changed

- Canvas files now default to **Source** view instead of Preview. Preview remains the default for previewable tool (stdout) output
- Tool results now default to compact one-line disclosure rows, with
  `muse.toolDisplay` settings for Compact, Balanced, and Detailed presentation

## [0.1.16] - 2026-08-17

### Changed

- Links and file chips now open in the main editor area: canvas Preview when the
  file can be rendered, otherwise an editor tab. Only web URLs and formats with no
  in-app renderer (`.xls(x)`, `.pdf`, Office docs) still go to the OS
- Canvas file reads also cover Muse's own data directory, so session logs under
  `~/.local/share/muse` open instead of being refused

### Fixed

- File chips are verified on the extension host and only appear for paths that
  exist on disk, so placeholder paths in prose no longer produce a dead chip
- `.jsonl` paths are no longer truncated to `.json` when detecting documents;
  `.jsonl` and `.markdown` are recognized
- Links no longer swallow the punctuation that follows them in prose, so
  `(https://example.com/)` links to `https://example.com/` and a trailing period
  or comma stays in the text. Brackets a URL opens itself are kept, e.g.
  `…/wiki/Foo_(bar)`
- Relative paths keep their leading segment: `docs/STATUS.md` and
  `.trailz/plans/x.md` no longer detect as `/STATUS.md` and `/plans/x.md`.
  Relative, `./`, `../`, and `~/` paths now resolve against the Muse folder
  
## [0.1.15] - 2026-08-13

### Added

- **File canvas**: click file chips (md/html/json/yaml/toon/csv/txt) in chat or tool output to open a Preview/Source canvas by reading the workspace file (512 KB cap, workspace jail)
- CSV/TSV table preview in canvas; `.xls`/`.xlsx` chips open externally only
- `muse.chatFormat` setting (`markdown` default, or `plain`) for sanitized assistant Markdown in the sidebar
- Expanded stdout Preview kinds: json, yaml, toon, csv, text (in addition to markdown/html)

## [0.1.14] - 2026-08-11

### Added

- **Clean Up Sessions**: multi-select delete of Muse sessions for the current folder (index rows + log dirs under Muse’s data root). Available from History and **Muse CLI Chat: Clean Up Sessions**

## [0.1.13] - 2026-08-11

### Added

- Canvas **Preview** mode for Markdown and HTML tool output (sandboxed iframe). Shown when output looks like a document; exec envelopes preview stdout only. **Open externally** when a `.html`/`.md` path is detected

### Fixed

- Local `.html` / `.htm` links open via the OS (`open` / `xdg-open`) so the default browser gets `file://…` (avoids Cursor/VS Code `openExternal` “No application found to open URL”). Other local paths reveal in Finder/Files

## [0.1.12] - 2026-08-11

### Added

- **Open in canvas**: full-height side panel for tool results (Readable / Raw, clickable links, Copy). Opens beside the editor from each tool card or **Muse CLI Chat: Open Last Tool Result in Canvas**

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
