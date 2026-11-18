# Conversation names and branches

Use **Rename** and **Branch** beside the conversation title, or the **Muse Code: Rename Conversation** / **Muse Code: Branch Conversation** commands. Commands target the focused Muse chat.

## Names

Names are saved in this VS Code workspace, shared between its Muse panels and editor chats, and restored after reload. They appear in editor tabs, headers and session-history search. Unicode names are accepted; empty names, control characters and names longer than 120 characters are rejected. Existing drafts, attachments, messages and branch ancestry are kept. Empty conversations can be named before the first message.

These are extension-owned names. The Windows Muse 1.4.15 runtime explicitly rejected native `session/rename` as unsupported during acceptance testing. The extension does not edit Muse's database or logs to work around that limitation and does not claim CLI-wide renaming.

## Branches

Branch invokes Muse's native `session/fork`, through all completed turns, and opens the returned independent session in a new editor tab. The header identifies its parent. The source remains open with its own draft. Nothing is sent automatically. Subsequent messages belong to the new session.

This is a conversation branch, not a Git branch or worktree. Workspace files stay as they are; no undo or tool replay occurs. The branch does not inherit extension Undo/Redo cards for old source turns. Incomplete turns and unsent drafts are not copied. Older context descriptors unavailable in the new chat retain the existing reattachment warning when using a historical request as a draft.

Branch requires a retained Muse session, an idle source and an available workspace lease. The extension validates the returned independent session id, persists ancestry, and uses the source's folder in multi-root workspaces. It does not change approval policies or bypass the existing mode-transition guard.

The operation calls `session/fork` directly, without `session/resume`: the latter has separately observed Windows metadata side effects. There is a 45-second deadline and no automatic command replay. A timeout can have an unknown outcome; check history before retrying. CLI errors are shown without clearing the source draft.

Some Windows Muse hosts create a functional native fork without adding a session-index row. The extension retains its own registered branch identity and parent, then discovers its durable log under the date-based Muse sessions directory. This read-only fallback is limited to registered branches, validates exact fork/parent ids and any retained workspace metadata, stays within the Muse sessions directory and bounds date-directory inspection to 2048 and log size to 32 MiB. It never repairs the CLI database. Native `session.fork.turn` public prompts/answers are displayed before later turns; internal model-prefix/reasoning records are excluded.

## Live acceptance — 2026-11-13

- The parent chat was named **Muse Dal Testi · Ana**. First real turn stored `MUSE_BRANCH_7KD4` and returned `MUSE_PARENT_READY`, without tools.
- Clicked Branch with an unsent parent draft present. The child was explicitly asked for the prior code without including it in the new request; the real model returned `MUSE_BRANCH_7KD4`.
- Renamed the child **Muse Dal Testi · Alternatif**. After reload, its name, parent provenance, inherited public turn and new child turn appeared exactly once. History search for **Alternatif** found the child; the unfiltered list showed both names.
- Returned to the parent after reload: its original one-turn history and `MUSE_PARENT_DRAFT_KEEP` draft remained separate. The parent log hash stayed unchanged between the completed fork and the child's subsequent model request; native fork bookkeeping itself legitimately appends diagnostics to the source log.
- Checked the approximately 330px panel; title, Rename/Branch, parent label and composer fit. Restored the original panel width. Source fixture `src/app.ts` SHA-256 remained unchanged.
- TypeScript, 302 tests / 947 assertions, static UI detector and diff whitespace checks passed. Installed, reloaded and tested the development VSIX. No security settings, ACLs, CLI index rows, commit, push or PR changed by the extension work.

The first native-rename probe reported unsupported on Windows; that rejected probe also demonstrated the existing MSP resume metadata issue. Production rename uses local workspace metadata and production fork uses the direct endpoint. During testing the missing-index path briefly caused duplicated cached child messages and an unknown-policy notice; verified-log recovery fixed hydration and restored the existing permission check to the actual child log. No approval bypass was added.
