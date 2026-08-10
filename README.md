# Muse CLI Chat (unofficial)

VS Code / Cursor sidebar chat that drives Meta’s **Muse Code** CLI (`muse exec --json`). The agent harness stays Muse; this extension is only the IDE UI.

**Not affiliated with Meta.** Muse Code, Muse Spark, and related marks belong to Meta. Install and authenticate Muse separately: [Muse Code docs](https://dev.meta.ai/docs/muse-code).

Privacy and security: [PRIVACY.md](./PRIVACY.md) · [SECURITY.md](./SECURITY.md)

## Requirements

- macOS or Linux (Muse Code CLI does not support Windows yet)
- [Muse Code](https://dev.meta.ai/docs/muse-code) installed and signed in (or `META_API_KEY` set)
- VS Code or Cursor
- An open workspace **folder** that is not a symlink root (Muse rejects reparse points)

```bash
curl -fsSL https://dev.meta.ai/install.sh | sh
muse login
# or: export META_API_KEY=...   # must be visible to the editor process
```

The sidebar treats Muse as ready only when the CLI is present **and** credentials are visible (`META_API_KEY` in the editor env, stored `~/.config/muse/auth.json`, or `muse.useEchoProvider`). A key set only in your terminal shell does not reach Cursor/VS Code unless you launch the app from that shell or set it in the GUI environment.

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
4. Send a prompt

## Commands

| Command | Action |
|---------|--------|
| Muse CLI Chat: Open Chat | Focus the sidebar |
| Muse CLI Chat: Send Selection | Send the editor selection as context |
| Muse CLI Chat: New Session | New `--session-id` |
| Muse CLI Chat: Stop | SIGINT the running `muse exec` |
| Muse CLI Chat: Open Interactive Terminal | Full Muse TUI (approvals, slash commands) |
| Muse CLI Chat: Check Installation | `muse --version` |
| Muse CLI Chat: Select Workspace Folder | Pick which root to use (multi-root) |
| Muse CLI Chat: Resume Session | Pick a retained Muse `--session-id` for this folder and reload history |

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

## History

The sidebar keeps Muse’s `--session-id` in workspace state. **History** / the session id chip opens a picker of retained sessions for the current folder (from Muse’s local session index). Choosing one resumes that id for later `muse exec` calls and hydrates the transcript from the session log (with `muse export` as fallback). A small local cache paints instantly while hydration runs.

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
