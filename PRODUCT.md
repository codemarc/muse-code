# Product

## Platform

VS Code desktop extension with a local HTML/CSS/JavaScript webview. TypeScript extension host and the installed Muse CLI/MSP supply execution.

## User and job

The user develops a personal fork into a daily coding assistant in VS Code and may contribute changes upstream. The requested experience is comparable to Claude Code/Codex: independent conversations, readable streaming, explicit permissions, file context, reviewable per-turn changes, safe undo and reliable Stop.

## Confirmed commitments

- Use Muse's existing logo and colors, as explicitly requested. Keep the extension's unofficial status clear.
- Preserve existing work, drafts, attachments, session history and permission decisions.
- Validate actual behavior in VS Code. Separate extension defects from Muse CLI/MSP runtime defects.
- Continue routine implementation without repeated clarification. Existing approval boundaries still apply.
- Keep native editor theme, keyboard navigation, narrow sidebars, light/dark and high-contrast use viable.

## Scope of this iteration

Improve conversation continuity (prepare a draft while a response runs, reuse a prior request), repair the missing new-chat command contribution, and apply Muse's confirmed brand to the existing interface. No automatic replay of tools, no automatic message queue and no machine-security changes.

## Open decisions

Marketplace naming/publisher and publishing are unchanged. Larger features such as branching conversations, rename/grouping and richer runtime usage displays remain separate follow-ups.
