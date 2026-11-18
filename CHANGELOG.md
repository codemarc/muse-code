# Changelog

## Unreleased

### Muse 1.4.20 compatibility

- Show the tool name and readable stdout for the newer exec tool result format. Keep the original payload available in Raw view.

### Conversation names and branching

- Add persistent workspace-scoped conversation names in headers, editor tabs and searchable history, retaining drafts and ancestry. Use extension-owned metadata because Muse's Windows native rename endpoint reports unsupported; no CLI database/log edits.
- Branch all completed turns using Muse's native session/fork and open the confirmed independent session in a new editor chat. Preserve the source draft and folder, show parent provenance, retain permission guards and serialize with other workspace operations.
- Fork directly without resume, avoiding the known Windows resume metadata side effect. Bound operation time, disable conflicting controls, validate the returned id and do not automatically retry an ambiguous outcome.
- Restore registered forks omitted from Muse's index through bounded, ancestry-validated local-log discovery. Render committed fork-seed public turns before later turns, excluding internal model context. Real parent/child context, independent names/drafts, reload, history search and narrow-panel checks passed; 302 tests / 947 assertions passed.

### Muse interface and conversation continuity

- Use Muse's original blue logo and published palette across the header, welcome screen, Send button and editor icons; retain native theme surfaces, accessible focus and high-contrast variants. Record artwork provenance in `media/BRAND.md`.
- Prepare the next draft while Muse works. Stop, completion, transcript refresh and window reload preserve it; sending remains an explicit action after the current turn ends.
- Add **Use as draft** to prior requests. Restore retained explicit context descriptors, protect an occupied composer and warn when older context needs reattaching. This creates a new turn without rewriting history or automatically replaying tools.
- Declare the existing New Chat command in the extension manifest.
- Validate with real model responses in VS Code: draft during streaming, Stop of an active response, reload retention, context reuse after reload, light/dark/high-contrast themes and a narrow panel. TypeScript and 296 tests / 914 assertions passed. See `docs/extension-ux-status.md` for scope and remaining gaps.

### Session mode transitions

- Inspect retained approval policy before exec starts. Panel-to-Headless/Windows transitions show explicit recovery actions instead of entering a hidden approval wait; drafts and attachments survive both recovery and reload. Existing session policies are preserved.
- Offer Use Panel approvals for the same session or Start new session for the selected mode. Guard stale session/mode actions and revalidate on submit under the workspace lease.
- Make executionMode resource-scoped and update its effective setting so a workspace/folder override no longer silently defeats the mode picker. Report setting-write failures in chat.
- Recover MSP-cleared workspace metadata from bounded, verified local session logs for history and mode checks, without writing the CLI index or mixing other workspace histories.
- Live VS Code validation: blocked send left the old session log unchanged; same-session Panel recovery and new-session Windows recovery both returned real model markers; draft/Problems attachment and reload preservation, narrow layout, and old-session history search passed. 290 tests / 849 assertions passed.

### Windows shell compatibility

- Add an explicit Windows compatibility mode using exec's legacy shell with the OS sandbox enabled and existing Headless permissions. Reject yolo in this mode; panel approvals/questions remain available in Panel mode only.
- Allow exec to resume a validated Windows workspace whose stored MSP path differs by the canonical verbatim prefix.
- Verify real VS Code shell execution inside OneDrive after explicitly approved ancestor traversal repair: sandbox identity, controlled file read/write, exit 7, Stop during a running command, and the next successful command. MSP still reports sandbox unavailable despite ready setup.
- Disable background reminders in Windows compatibility mode after a live run left an internal read worker and the next sandbox admission timed out on the ACL publication lock. Subsequent controlled exit/Stop/recovery tests passed; this is a compatibility workaround, not a host-runtime fix.
- Provide a preview-first, non-inherited ancestor traversal repair with ACL backup and guarded rollback on partial failure. Use target-only DACL publication to avoid Set-Acl reprocessing existing child inheritance. Document the requirement to start a new chat when switching from Panel approvals, whose stored policy can otherwise leave exec waiting for hidden approval.

### In-panel questions and tool outcomes

- Answer Muse `request_user_input` questions inside chat: single/multiple selection, custom answers, selection limits, retry without losing edits, stale/duplicate-answer guards, and Stop cleanup.
- Keep each chat's question queue independent and render pending requests from the SDK fold without replacing its notification handler.
- Show explicit failed/rejected/cancelled/timed-out tool badges without inventing exit codes. Preserve SDK command/exit/outcome facts by tool-call id when refreshing history.
- Document a locally reproduced Windows runtime problem: official sandbox setup/check reports ready, but Muse 1.4.15 MSP shell execution still fails. Shell support is not claimed from readiness alone.

### Panel approvals and independent chats

- Add the default **Panel approvals** mode using Muse's MSP SDK: explicit server-offered choices, grant scope, optional feedback, stale-stage guards, streamed replies and Stop while waiting for permission. Headless JSONL and interactive terminal modes remain available.
- Open independent editor chats with separate session/transcript caches, drafts, approvals, folder choices and cancellation. Restore editor chat identities and drafts after window reload.
- Guard whole-workspace checkpoints against overlapping turns or restores from another chat; retain the blocked chat's draft. Different workspace roots can run independently.
- Require VS Code 1.96+ for the SDK's Node 20 runtime. Native panel mode targets Muse 1.4.15+ and creates UUIDv7 session ids.

### Session history

- Search the workspace's retained session index by title, first prompt, or session id before applying the recent-results limit.
- Add focused search, arrow-key selection, Enter to resume, Escape to dismiss, empty states, and stale-response protection to the history picker.

### Turn checkpoints

- Reapply an undone turn with guarded Redo; newer edits and unsaved buffers block it without changing any files.

- Persist per-turn before/after snapshots outside the repository; open immutable native VS Code diffs after reload.
- Undo a completed turn without resetting the Git index or discarding pre-turn working-tree edits. Later file edits or unsaved buffers block the entire undo.
- Capture stopped turns after the process closes; keep incomplete checkpoints unavailable for unsafe undo.

### Added

- **Windows support.** Muse Code now ships for Windows, so the extension no longer refuses `win32`:
  - `muse.executablePath: "muse"` resolves to the signed `muse-bin-<version>.exe` named by `.muse-version` in `%LOCALAPPDATA%\Programs\muse` (then install dirs / `muse.exe` on `PATH`). The `muse.cmd` shim cannot be spawned with `shell: false`, and going through `cmd.exe` would shell-parse prompts, so it is never used; a configured `muse.cmd` path maps to the exe beside it
  - Stop kills the whole process tree with `taskkill /T` (Windows has no SIGINT/SIGTERM), and still reports the turn as Interrupted
  - Session history matches Muse's Windows index keys (`C:\…` and `\\?\C:\…`) even though VS Code reports `c:\…`
  - Editor context (open editors, Problems) and file chips/links understand backslash and drive-letter paths; `file:///C:/…` links map to `C:\…`; local `.html` reports open with Explorer
- CI runs typecheck and tests on `windows-latest` as well as Ubuntu
- **Chat lives in the secondary (right) side bar** on VS Code 1.106+, so Explorer stays visible while Muse works. Both a secondary-side-bar and an activity-bar container are declared and a context key (`muse.doesNotSupportSecondarySidebar`) picks one, the same pattern Codex and Claude Code use; Cursor and older VS Code keep the activity-bar view. Cursor may log a warning about the secondary-side-bar contribution at startup
- **Editor title toggle** (`muse.toggleChat`): one click shows the chat, a second click hides its side bar

### Changed

- **Chat panel layout.** One-line header (name, session id, history and new-session icons); a single composer box with the attach button, mode/model/effort, and one Send/Stop button inside it; the duplicate History button and the always-on help text are gone. Tips and the unofficial notice now show in an empty-state welcome instead. Assistant replies render as plain text without a card, tool calls as compact rows with a green/red status dot, and inline code, code blocks and links use theme colors. Icons are inline SVG because the webview CSP blocks icon fonts
- View toolbar keeps the Open in Editor Panel icon; session, view and link actions moved to the `…` menu
- Run-setting pills sit under the input box with short labels (`Headless`, `Model auto`, `Effort default`; full text in the tooltip) so they never truncate in a narrow side bar
- **In-chat pickers.** Mode, model and effort pills open dropdowns that update the setting directly (model list: known ids, models named in Muse's own settings.json, the current one, and "Other model…"); the history button opens a session dropdown (new session, resume with relative time and turn count, clean up)
- **Inline @ mentions.** Picking a file with `@` keeps `@path` in the prompt instead of moving it to a chip above; its contents are attached at send time while the token is still in the text, and user messages render the token as an inline pill
- **Working indicator** while a turn runs; the redundant "Run started" line and raw unknown JSONL events are no longer shown
- Echo replies no longer show the `<attached-context>` block
- Header shows the chat title (first prompt, from the Muse index) instead of the session hash; "New chat" until the first turn
- `@file` tokens are highlighted while typing (a mirror layer behind the textarea, built from text nodes) and stay highlighted after the transcript is rebuilt from history
- The model picker can switch the echo (offline test) provider off and on; the pill reads "Echo" while it is on
- Container title is now "Muse"; with `workbench.secondarySideBar.showLabels` off, VS Code shows the Muse icon instead

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
