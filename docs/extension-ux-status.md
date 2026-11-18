# Extension UX status — 2026-11-12

This iteration prioritizes daily conversation continuity and Muse identity. It does not claim full feature parity with Claude Code or Codex.

## Delivered in this iteration

| Gap | Result |
| --- | --- |
| Composer blocked for an entire response | Prepare text and context while Muse works. Send waits for completion or Stop; there is no implicit queue. |
| Retyping an earlier request | Use as draft restores its displayed text and explicit retained context into an empty composer. Existing history is unchanged. |
| Context loss after history refresh/reload | Persist descriptor-only metadata scoped to chat, session and expanded-prompt hash. Retain the latest 64 requests, up to 16 descriptors each. Older or unavailable context produces a reattachment warning. |
| Missing new-chat command declaration | Declare the existing handler in the command manifest. |
| Generic branding | Package Muse's original mark and blue gradient locally; use native surfaces, readable editor foregrounds, explicit focus and high-contrast variants. |

Reusing a request requires review and Send. File contents, Problems and other context are collected again at send time; this is not a frozen replay of the original context. File access descriptors come from the extension's request metadata, never inferred from arbitrary transcript text. A non-empty composer cannot be replaced by a reuse action.

## Actual VS Code acceptance

Trusted fixture: `muse-test-ws`. Real model turns ran in Windows compatibility mode. These new tests requested no tools and made no source-file changes.

- Prepared a next-message draft during a numeric response; it did not send automatically.
- Explicitly sent the draft with Problems attached; received `MUSE_DRAFT_AFTER_STOP_OK`. The first numeric response completed naturally before Stop, so this marker alone is not evidence of cancellation.
- Used the prior request as a draft, retained Problems, edited and sent it; received `MUSE_REUSE_CONTEXT_OK`. Occupied-composer reuse controls remained disabled.
- Started a longer 1–10000 response, prepared another draft, and clicked Stop while streaming. Output ended at 4756 with Stopped displayed and the draft intact.
- Reloaded VS Code; the draft survived. Explicit Send returned `MUSE_STOP_DRAFT_RETAINED_OK` in the same session.
- After reload, Use as draft restored the earlier request and Problems from retained history without an older-context warning.
- Inspected Light Modern, Dark High Contrast and the user's original Desert Lights Italic theme. Restored the original theme and panel width after testing; the approximately 340px panel retained the logo, wrapped notice, welcome content and composer.
- TypeScript passed; 296 tests / 914 assertions passed. Static UI detector reported no findings. Fixture `src/app.ts` SHA-256 remained unchanged.

## Optional follow-up priorities

The current feature delivery is complete; these ideas do not block the local package. See [delivery status](delivery-status.md) for the final checks and runtime limits.

1. Conversation organization: grouping and choosing an earlier completed-turn branch boundary. Workspace names and native completed-history branching are now implemented; see [conversation management](conversation-management.md).
2. More useful live tool progress and navigation across larger transcripts, based on actual CLI/MSP events.
3. Context/token/cost display only where Muse supplies reliable measurements; do not invent usage estimates or claim image understanding from attachment filenames.
4. An optional explicit message queue, with visible cancellation and editing, if desired beyond the delivered draft workflow.

Existing independent chats, permission forms, searchable history, mode-transition recovery and durable turn Undo/Redo remain part of the extension. Same-root turns are serialized to protect shared-workspace checkpoints; independent chats are not isolated worktrees.

## Separate upstream runtime limitations

Muse MSP can report the Windows sandbox unavailable despite successful official setup. Legacy exec can encounter the sandbox ACL publication lock; the Windows compatibility mode disables background reminders as a mitigation, not a general runtime repair. MSP has also cleared workspace metadata in its session index; the extension performs bounded read-only log recovery instead of modifying that index.

See [Windows runtime evidence](windows-sandbox-runtime.md) and [mode-transition behavior](session-mode-transitions.md). No new ACL changes, permission bypasses or CLI database writes were made in this iteration.
