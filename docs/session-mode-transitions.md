# Session mode transitions

## Extension behavior

An execution-mode selection changes the client used to run a session. It is not consent to rewrite the session's retained permission policy. Muse exec can print a per-run approval-disabled banner while still retaining an MSP policy that waits for interactive approval. The extension therefore inspects the durable policy before launching exec.

For an existing session requiring an approval-capable client, Headless and Windows compatibility show an inline notice above the composer. Send and its keyboard shortcut cannot launch the run. The draft remains editable, with attachments and mentions intact.

- **Use Panel approvals** keeps the session and selects its approval-capable client. The draft is sent only when the user presses Send.
- **Start new session** creates a session for the selected mode. The old session is retained in history and its policy is preserved. The draft/attachments stay ready to send; the previous conversation is not silently copied into the new session.

Missing, unreadable, unknown, changing or oversized (over 32 MiB) policy evidence produces an explicit verification notice for existing sessions. Fresh sessions can start normally after the existing Headless consent check. Explicit durable approval reconfiguration takes precedence over CLI per-run security banners; rejected reconfigurations cannot change routing. Policy inspection is local and read-only.

The host repeats the check under the workspace lease before accepting a submission. Resolution actions are bound to the session and mode that produced the notice, and ignored during a run, preflight or checkpoint operation. Stale UI messages cannot reset another session. A mode/session change during asynchronous preparation leaves the draft ready to send again.

The picker writes to the effective configuration scope: an existing folder override, then workspace override, otherwise user settings. `muse.executionMode` supports resource scope. Setting-write failures are reported in chat. Permission settings such as disableApproval and yolo retain their existing application scope and consent flow.

## CLI behavior kept separate

Two observed Muse behaviors are handled at the extension boundary:

1. Exec can retain an old interactive approval policy despite a disable-approval flag. The extension blocks the incompatible route and offers the two actions above.
2. MSP resume cleared both workspace columns in an existing CLI index row. The extension recovers association only when a recognized local durable record positively identifies the selected workspace. It reads bounded logs for at most 500 recent unbound candidates (full-id queries filter before this limit), caches file metadata, and preserves indexed titles where available. Missing evidence and other workspace roots are excluded. It does not repair or write Muse's database.

The [Windows sandbox/MSP runtime failures](windows-sandbox-runtime.md) remain separate upstream limitations. This change does not install sandbox components or alter machine ACLs.

## Real VS Code validation — 2026-11-12

- Restored the old MSP session in Windows compatibility. The notice appeared before sending. Ctrl+Enter left the durable log unchanged at 1,672,498 bytes with the same timestamp; the draft remained present.
- Added a Problems attachment, reloaded VS Code and confirmed the draft, attachment and notice returned.
- Chose Use Panel approvals: the effective workspace setting changed to panel, the session id stayed the same, and the draft/attachment survived. Sending returned the real model response `MUSE_MODE_SWITCH_PANEL_OK`.
- Typed another draft and selected Windows compatibility in the actual mode picker. The notice returned immediately. Its text/buttons remained usable with an approximately 340 px editor width; the previous layout was restored afterward.
- Chose Start new session: the id changed, the notice cleared, the exact draft and Problems attachment stayed ready to send. Sending returned `MUSE_MODE_SWITCH_EXEC_OK` through exec.
- Searched history for the previous full session id and found one matching retained session after the new conversation completed.
- TypeScript and 290 tests / 849 assertions passed, including policy precedence, stale UI messages, draft/attachment retention, effective configuration scope, verified workspace association, exclusion of other workspaces and read-only index behavior.

The pre-existing fixture source file hash remained unchanged. No new machine ACL or sandbox-policy modification was part of these tests.
