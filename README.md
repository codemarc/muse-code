# Muse CLI Chat (unofficial)

VS Code / Cursor sidebar chat that drives Meta’s **Muse Code** CLI (`muse exec --json`). The agent harness stays Muse; this extension is only the IDE UI.

**Not affiliated with Meta.** Muse Code, Muse Spark, and related marks belong to Meta. Install and authenticate Muse separately: [Muse Code docs](https://dev.meta.ai/docs/muse-code).

## Requirements

- macOS or Linux (Muse Code CLI does not support Windows yet)
- [Muse Code](https://dev.meta.ai/docs/muse-code) installed and signed in (or `META_API_KEY` set)
- VS Code or Cursor
- An open workspace **folder** that is not a symlink root (Muse rejects reparse points)

```bash
curl -fsSL https://dev.meta.ai/install.sh | sh
```

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
code --install-extension muse-cli-chat-0.1.1.vsix
# Cursor: cursor --install-extension muse-cli-chat-0.1.1.vsix
```

## Develop

```bash
git clone https://github.com/codemarc/muse-code.git
cd muse-code
bun install
bun run compile
```

Open this folder in VS Code/Cursor and press **F5** (Run Muse CLI Chat Extension). In the Extension Development Host:

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

## Settings (`muse.*`)

| Setting | Default | Notes |
|---------|---------|-------|
| `executablePath` | `muse` | Also tries `~/.local/bin/muse` |
| `model` | empty | Optional `--model` |
| `reasoningEffort` | empty | Optional `--reasoning-effort` |
| `trustWorkspace` | `true` | Loads project skills/rules |
| `disableApproval` | `true` | Needed for headless; sandbox stays on |
| `yolo` | `false` | Disables approval **and** sandbox (dangerous) |
| `useEchoProvider` | `false` | Offline UI smoke tests |
| `extraArgs` | `[]` | Extra argv |

## Safety

Headless `muse exec` cannot answer interactive approval prompts. The extension defaults to **`--disable-approval` with the OS sandbox still on** (Meta’s recommended CI posture). For staged shell approvals, use **Muse CLI Chat: Open Interactive Terminal**.

Never enable `muse.yolo` on a machine with real credentials unless you fully trust the workspace. Enabling it shows a one-time warning.

## Tests

```bash
bun test
bun run check
```

## Publish

1. Create publisher `codemarc` on [VS Code Marketplace](https://marketplace.visualstudio.com/manage) and/or [Open VSX](https://open-vsx.org/) (change `publisher` in `package.json` if you use another id).
2. `bun install` then `bun run package` (produces `muse-cli-chat-0.1.1.vsix`).
3. Open VSX (good for Cursor): `npx ovsx publish muse-cli-chat-0.1.1.vsix -p <token>`
4. VS Code Marketplace: `bunx vsce publish --no-dependencies` (after `vsce login`)

Production compile minify: `NODE_ENV=production bun run compile`.
