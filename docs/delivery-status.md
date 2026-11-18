# Local delivery — 2026-11-18

The VS Code extension feature work is complete for this delivery. Further product ideas are optional follow-up work, not blockers for this package. This is a local development delivery, not a Marketplace release or a claim that Muse's upstream Windows runtime is fixed.

## Included

- Muse branding and theme-aware chat UI.
- Independent editor chats, persistent drafts and searchable session history.
- Prepare drafts while streaming and reuse previous requests with retained context.
- Persistent conversation names and native branching with independent child context.
- Per-turn saved diffs, guarded Undo/Redo and overlapping-workspace protection.
- Panel approvals/questions, explicit tool outcomes and Stop handling.
- Mode-transition recovery that preserves the draft and previous conversation.
- Windows compatibility execution with the OS sandbox enabled.

## Use

Install the local `muse-cli-chat-0.5.1-dev.vsix` using VS Code's **Extensions: Install from VSIX...**, then reload when prompted. The package keeps the existing extension identity (`codemarc.muse-cli-chat`) and version so existing settings and local chat metadata remain associated with it.

Open **Muse CLI Chat: Open Chat**. The installed build passed real-model VS Code acceptance for the features above on Muse 1.4.15. On Muse 1.4.20, real-model smoke tests passed through the extension's Panel adapter and the Headless and Windows compatibility argument and event paths.

On the Windows setup recorded in this workspace, shell execution was verified in **Windows compatibility** mode. Panel approvals/questions belong to **Panel** mode. Switching an existing Panel session to exec may show a recovery notice; use its explicit recovery action. Do not change permissions or disable the sandbox to dismiss the notice.

## Verification

- TypeScript: passed.
- Bun: 303 tests passed with 949 assertions.
- Git whitespace check: passed.
- Production bundle: built with `node esbuild.mjs --minify`.
- Current webview rendered at 340 px and 500 px with conversation, streaming and empty states.
- Muse 1.4.20 reports the Windows sandbox ready. A controlled PowerShell tool call through Panel mode still failed before execution with `windows_elevated setup_required`.
- Windows compatibility mode executed a real sandboxed PowerShell command and exposed its stdout as readable tool output through the corrected exec parser.

The restricted runner initially blocked Git/Node child processes. The same test suite passed when run with the required process permission; no source change was needed.

## Known limits and follow-up

Muse 1.4.15 MSP's Windows sandbox availability problem and intermittent legacy sandbox ACL publication locks remain upstream limitations. Previously verified local-log recovery handles missing session metadata/index entries without writing the Muse index. Names remain extension-owned workspace metadata because native Windows rename is unsupported. See [Windows runtime evidence](windows-sandbox-runtime.md), [mode transitions](session-mode-transitions.md) and [conversation management](conversation-management.md).

The native chat exposes a subset of the CLI. Terminal workflows such as slash commands, plugins, voice, MCP and account management retain their own CLI entry points. The real-model smoke tests cover the extension's chat paths and do not certify these standalone CLI commands.

Grouping conversations, branching at an earlier individual turn, richer long-transcript navigation, measured usage displays and an explicit message queue remain optional backlog.
