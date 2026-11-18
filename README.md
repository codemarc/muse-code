# Muse CLI Chat (unofficial)

### [Inception: A Muse Inside Muse](https://blog.codemarc.net/inception-a-muse-inside-muse)

VS Code / Cursor sidebar chat that drives Meta’s **Muse Code** CLI (`muse exec --json`). The agent harness stays Muse; this extension is only the IDE UI.

**Not affiliated with Meta.** Muse Code, Muse Spark, and related marks belong to Meta. Install and authenticate Muse separately: [Muse Code docs](https://dev.meta.ai/docs/muse-code).

Privacy and security: [PRIVACY.md](./PRIVACY.md) · [SECURITY.md](./SECURITY.md)

## Extension experience

- Independent editor conversations, retained history and per-chat drafts.
- **Rename** saves conversation names in this VS Code workspace, including history search. **Branch** opens an independent Muse conversation through all completed turns, preserving the source and its draft. [Behavior and CLI limitations](./docs/conversation-management.md).
- Prepare your next message while Muse responds; Stop and reload keep the draft. Send it explicitly once the current turn ends.
- **Use as draft** copies an earlier request and its retained context into an empty composer. Review it and send a new turn. It never overwrites an existing draft; older context that cannot be restored is marked for reattachment. Context is collected again when you send.
- In-panel approvals/questions, visible execution modes and safe mode-transition recovery.
- Persistent per-turn file diffs with guarded Undo/Redo that preserve edits made before the turn.
- Muse's original logo and blue palette, native editor themes and high-contrast support. [Brand provenance](./media/BRAND.md).

See [tested behavior and remaining extension priorities](./docs/extension-ux-status.md). Muse CLI/MSP runtime limitations are tracked separately in [Windows runtime notes](./docs/windows-sandbox-runtime.md).

## Requirements

- macOS, Linux, or Windows (see [Windows](#windows))
- [Muse Code](https://dev.meta.ai/docs/muse-code) installed and signed in (or `META_API_KEY` set)
- VS Code or Cursor
- An open workspace **folder** that is not a symlink root (Muse rejects reparse points)

```bash
curl -fsSL https://dev.meta.ai/install.sh | sh
muse login
# or: export META_API_KEY=...   # must be visible to the editor process
```

The sidebar treats Muse as ready only when the CLI is present **and** credentials are visible (`META_API_KEY` in the editor env, `~/.config/muse/auth.json` with an inline key/token **or** a Keychain-backed `muse login`, or `muse.useEchoProvider`). A key set only in your terminal shell does not reach Cursor/VS Code unless you launch the app from that shell or set it in the GUI environment.

### Windows

Install Muse Code with the official Windows installer ([docs](https://dev.meta.ai/docs/muse-code)). It installs per user into `%LOCALAPPDATA%\Programs\muse` as a `muse.cmd` launcher plus a signed `muse-bin-<version>.exe`.

- With `muse.executablePath` left at `"muse"`, the extension reads `.muse-version` in that folder and runs the matching `muse-bin-<version>.exe` directly (no `cmd.exe`, no PowerShell). Install dirs on `PATH` and a plain `muse.exe` on `PATH` also work.
- Setting `muse.executablePath` to the `muse.cmd` path (what `where muse` prints) is fine too; it is mapped to the exe beside it.
- The launcher's self-update runs when you start `muse` from a terminal; the extension picks up the new version from `.muse-version` on the next run.
- Credentials and sessions use the same locations as on Linux: `%USERPROFILE%\.config\muse\auth.json` and `%USERPROFILE%\.local\share\muse`.
- **Stop** ends Muse and every process it started (`taskkill /T`), so dev servers launched by a turn do not linger.
- On first run, Muse's Windows sandbox asks for elevation once to create its local sandbox accounts (`muse-sbx-*`); that is Muse itself, not this extension.

## Install (published)

After this extension is on a marketplace:

- **VS Code Marketplace:** search “Muse CLI Chat” (publisher `codemarc`)
- **Open VSX / Cursor:** same extension id `codemarc.muse-cli-chat`

Or install a local `.vsix`:

```bash
git clone https://github.com/codemarc/muse-code.git
cd muse-code
bun install
bun run package
code --install-extension muse-cli-chat-0.1.8.vsix
# Cursor: cursor --install-extension muse-cli-chat-0.1.8.vsix
```

## Develop

```bash
git clone https://github.com/codemarc/muse-code.git
cd muse-code
bun install
bun run compile
```

Open this folder in VS Code/Cursor and press **F5** (Run Muse CLI Chat Extension). That runs `bun run compile` first (Bun must be on your PATH). Optional: **Run Muse CLI Chat Extension (watch)** for `bun run watch`. In the Extension Development Host:

1. Open a real directory (not a symlink)
2. Command Palette → **Muse CLI Chat: Open Chat** (or click the Muse activity icon)
3. Optional: set `muse.useEchoProvider` to `true` for offline JSONL UI testing
4. Send a prompt (**⌘Enter** on macOS, **Ctrl+Enter** on Linux and Windows, or the Send button). Enter inserts a newline. Type `@` to attach a file with contents, or **+ Attach** for the current file, open editors, Problems, or terminal output.

## Commands

| Command | Action |
|---------|--------|
| Muse CLI Chat: Open Chat | Open the configured native chat surface |
| Muse CLI Chat: Open in Editor Panel | Open the native chat in an editor panel (default shortcut `⌘⇧R` on macOS, `Ctrl+Shift+R` on Linux and Windows; rebind in Keyboard Shortcuts) |
| Muse CLI Chat: Toggle Chat | Editor title button: show the chat, or hide its side bar if it is already showing. On VS Code 1.106+ the chat lives in the secondary (right) side bar; Cursor and older VS Code use the activity bar |
| Muse CLI Chat: Open in Sidebar | Open the native chat in the sidebar |
| Muse CLI Chat: Open in New Window | Reopen the current workspace with Muse ready |
| Muse CLI Chat: Send Selection | Send the editor selection as context |
| Muse CLI Chat: New Session | New `--session-id` |
| Muse Code: New Chat | Open an independent conversation in a new editor tab |
| Muse Code: Rename Conversation | Save a name for the focused chat in this VS Code workspace |
| Muse Code: Branch Conversation | Open a native Muse fork through completed turns in a new editor tab; workspace files stay as they are |
| Muse CLI Chat: Stop | SIGINT the running `muse exec` |
| Muse CLI Chat: Open Interactive Terminal | Full Muse TUI (approvals, slash commands) |
| Muse CLI Chat: Copy Session and Open Muse.ai | Copy the current session as markdown, then open [muse.ai](https://muse.ai/) |
| Muse CLI Chat: Open Website | Muse Code product page |
| Muse CLI Chat: Open Billing | Meta AI billing |
| Muse CLI Chat: Check Installation | `muse --version` |
| Muse CLI Chat: Select Workspace Folder | Pick which root to use (multi-root) |
| Muse CLI Chat: Resume Session | Pick a retained Muse `--session-id` for this folder and reload history |
| Muse CLI Chat: Clean Up Sessions | Multi-select delete of old Muse sessions for this folder (local index + logs) |
| Muse CLI Chat: Open Last Tool Result in Canvas | Reveal the canvas panel with the last opened tool result |

## Settings (`muse.*`)

| Setting | Default | Notes |
|---------|---------|-------|
| `executablePath` | `muse` | `"muse"` on PATH, or absolute path to the binary (application-scoped) |
| `model` | empty | Optional `--model` |
| `reasoningEffort` | empty | Optional `--reasoning-effort` |
| `trustWorkspace` | `true` | Loads project skills/rules |
| `disableApproval` | `false` | First send prompts to enable for headless (application-scoped) |
| `yolo` | `false` | Disables approval **and** sandbox (dangerous, application-scoped) |
| `useEchoProvider` | `false` | Offline UI smoke tests |
| `extraArgs` | `[]` | Extra argv; `--yolo` / `--disable-sandbox` blocked (application-scoped) |
| `toolOutputFormat` | `readable` | Default tool result view: `readable` (terminal-style for exec) or `json` (raw payload). Each card can toggle. |
| `toolDisplay` | `compact` | Initial tool-card disclosure: `minimal` shows dense static one-liners (silent runs collapse to a working pulse), `compact` folds all results, `balanced` opens only short results, and `detailed` opens all results. |
| `chatFormat` | `markdown` | Assistant messages in the sidebar: `markdown` (sanitized) or `plain` text. |
| `preferredLocation` | `secondarySidebar` | Where **Open Chat** opens the native UI: `secondarySidebar`, `panel`, or `terminal`. |
| `useTerminal` | `false` | Open Chat launches the full Muse interactive terminal instead of the native UI. |
| `executionMode` | `panel` | `panel` reviews permissions through MSP; `headless` uses `muse exec --json`; `windows` uses exec's sandboxed legacy shell; `interactive` opens the Muse terminal. |

## History

The sidebar keeps Muse’s `--session-id` in workspace state. **History** / the session id chip opens a picker of retained sessions for the current folder (from Muse’s local session index). Choosing one resumes that id for later `muse exec` calls and hydrates the transcript from the session log (with `muse export` as fallback). A small local cache paints instantly while hydration runs. **Clean up sessions** (also in that picker) permanently deletes selected sessions for this folder from Muse’s local index and removes their log directories under `~/.local/share/muse/sessions` (close interactive Muse if the delete fails due to a DB lock).

Tool calls appear as one-line disclosure rows by default. Open a row to reveal
Readable / Raw output, file chips, and **Open in canvas**. The `toolDisplay`
setting chooses Minimal, Compact, Balanced, or Detailed initial disclosure;
Minimal rows are dense and static (no chevron, no success badge), and runs with
nothing sensible to show collapse to a `working…` pulse every five tools.
Failed calls keep a red exit badge and stay expandable in every mode. The
canvas shows the full tool output beside the editor and adds Preview when
stdout looks like a document.

Type `@` in the composer to attach a file (open editors, git changes, then workspace search). The pick becomes a context chip and the file contents are sent inline with your prompt, so the model does not need a round trip to read it. **+ Attach** adds the current file, all open editors, workspace Problems/diagnostics, or recent integrated-terminal output the same way (terminal output is captured via shell integration after the extension activates). The sidebar shows the compact prompt with chips; the full contents travel in the `muse exec` prompt and the session log. After a turn, files that changed in the git working tree appear as a **Changed files** card and open in canvas as a diff. That is a review of writes Muse already made, not an accept/reject patch flow.

**Panel approvals** is the default native-chat mode (Muse 1.4.15+ and VS Code 1.96+). Permission requests show the tool, target and arguments, and only the choices offered by Muse. Optional feedback is sent only with a choice that accepts it. No choice is selected automatically; unmatched actions use Muse's `promptUnmatched` approval mode. Existing policy rules can still allow actions without prompting. The panel keeps the host sandbox enabled and does not use `disableApproval`, `yolo` or exec-only `extraArgs`. **Headless** remains available for `muse exec --json`; **Interactive** opens the integrated terminal for other interactive input. `muse.useTerminal` remains a compatible terminal alias.

Muse's **questions** also appear in the panel: pick one or several offered options, or write an answer (up to 500 characters). Every question needs an answer; nothing is selected automatically. Failed submissions keep your answers for retry. Server settlement or Stop removes the form. Each chat owns its pending questions. Tool failures, rejection, cancellation and timeouts have explicit badges; an exit code is shown only when Muse supplied one.

When a retained session needs interactive approvals, switching to **Headless** or **Windows compatibility** shows a recovery notice before a run can start. Choose **Use Panel approvals** to keep that session, or **Start new session** for the selected mode. Your draft and attachments stay in the composer; the previous session stays in history. Unverifiable existing policies receive the same guard. The picker updates the effective user/workspace/folder setting. See [Session mode transitions](docs/session-mode-transitions.md) for behavior and live validation.

On Windows, a successful sandbox setup check does not guarantee shell execution. **Windows compatibility** mode uses Muse exec's `--enable-shell-tool` while keeping the OS sandbox enabled. It uses your existing Headless permission settings and cannot answer panel approvals/questions; it refuses to run with `muse.yolo` enabled. Background reminders are disabled in this mode to avoid additional Windows sandbox probes. After a consented ancestor-traversal repair, real VS Code tests in a OneDrive workspace verified sandbox identity, file read/write, exit 7, stopping a running shell and successfully running the next command. MSP's separate Windows sandbox failure remains unresolved. See [Windows sandbox runtime diagnostics](docs/windows-sandbox-runtime.md) for evidence and limitations.

Use the header **+**, **New Chat in Editor**, or **Open in Editor Panel** to open an independent editor chat. Each tab owns its session, draft, attachments, transcript, approvals and Stop action. Opening a new chat leaves existing chats running. Editor tabs restore their session and draft after a window reload; running turns stop when the extension host exits. History can reopen a previous conversation. Folder selection is stored separately for each chat.

To keep whole-workspace turn snapshots attributable, only one Muse turn or Undo/Redo operation can use a folder (or overlapping nested folder) at a time. Another chat keeps its draft and asks you to wait or choose a different root. Different workspace roots can run independently. This does not isolate manual edits or other external processes.

Paths to `.md`, `.html`, `.json`/`.jsonl`, `.yml`/`.yaml`, `.toon`, `.csv`/`.tsv`, and `.txt` appear as file chips. Chips are verified on the extension host, so only paths that exist on disk get one. Clicking a chip or a path in chat opens it in the main editor area: the canvas (Preview / Source) for files it can render from the workspace or Muse's data directory (512 KB cap), and a regular editor tab for everything else, including images and files outside those roots. Web URLs open in the browser, as do `.xls(x)`, `.pdf`, and Office documents, which have no in-app renderer. **Open externally** in the canvas still hands the current file to the OS, so an HTML report goes to the system browser.

## Search session history

Click **Session history** or the chat title to search retained sessions in the current workspace. Search checks the title, first message, and session id in the local Muse index, including sessions older than the initial recent list. It returns up to 40 recent matches; narrow the query to find older matches. It does not search every message in a transcript or contact the model.

Use **↑ / ↓** to select a result, **Enter** to resume it, and **Esc** to dismiss the picker and return focus to its header button. The current session, first-message preview, relative update time, turn count, and short session id help distinguish similar conversations.

## Persistent turn diffs and undo

Each native chat turn saves the on-disk contents of Git-tracked and non-ignored workspace files before Muse starts. When the turn ends (including Stop), its before/after changes become a persistent turn card. Click a file to open its saved, read-only **Before ↔ After** diff. These snapshots survive VS Code reloads and remain available after undo.

**Undo this turn** restores that turn's pre-existing working-tree contents, including your earlier staged and unstaged edits. It does not change Git's index, commits, or stashes. New files created during the turn are removed only when they still exactly match the captured result; files deleted during the turn are restored. If any affected file has newer edits, an unsaved editor, or a link/junction substitution, the whole undo is blocked before writing. Undo later turns first when multiple turns touched the same file.

Save workspace editors before sending. Changes made manually or by another program while Muse runs are part of that turn's captured before/after interval, so avoid editing the same files during a run. Ignored files and paths outside the workspace are not checkpointed. A Git workspace is required; checkpoints reject links, files over 4 MB, more than 20,000 files, and snapshots over 64 MB before execution. A process that adds unsupported files can leave its checkpoint unfinished; no unsafe undo is offered for it. Turns interrupted by an extension-host crash retain their pending baseline but do not offer automatic undo.

Snapshots contain local file contents and are stored under this extension's VS Code global storage directory, outside the repository. Completed turn cards are grouped by workspace and Muse session. Historical turns created before this feature do not have snapshots.

After undo, **Redo this turn** reapplies its saved after-version. Redo checks all affected files against the saved pre-turn version first and refuses the whole operation if a file was edited after undo or has an unsaved editor. Both actions preserve the Git index, and their status survives VS Code reloads.

## Safety

Headless `muse exec` cannot answer interactive approval prompts. `disableApproval` defaults **off**; on first send the extension asks before enabling `--disable-approval` (sandbox stays on). For staged shell approvals, use **Muse CLI Chat: Open Interactive Terminal** (launches Muse as the terminal process, not via a shell string).

Dangerous settings (`executablePath`, `extraArgs`, `yolo`, `disableApproval`) are **application-scoped** so a workspace cannot override them. Untrusted workspaces are not supported.

Never enable `muse.yolo` on a machine with real credentials unless you fully trust the workspace. Enabling it shows a one-time warning.

## Tests

```bash
bun test
bun run check
```

CI runs the same checks plus `vsce package` on every push/PR to `main` (see `.github/workflows/ci.yml`).

## Publish

1. Create publisher `codemarc` on [VS Code Marketplace](https://marketplace.visualstudio.com/manage) and/or [Open VSX](https://open-vsx.org/) (change `publisher` in `package.json` if you use another id).
2. `bun install` then `bun run package` (produces `muse-cli-chat-<version>.vsix`).
3. Open VSX (good for Cursor): `npx ovsx publish muse-cli-chat-<version>.vsix -p <token>`
4. VS Code Marketplace: `bunx vsce publish --no-dependencies` (after `vsce login`)

Production compile minify: `NODE_ENV=production bun run compile`.
