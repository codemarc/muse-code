# Windows sandbox runtime diagnosis

Observed locally on 2026-11-12 with native Windows Muse Code **1.4.15 (1.4.15-R8339.1)** and SDK **1.4.15**. MSP remains unresolved. Exec's legacy shell passed real VS Code acceptance inside OneDrive after an explicitly approved ancestor-traversal repair.

## Setup succeeded

The installed binary's official commands were run:

```powershell
muse sandbox windows setup
muse sandbox windows check
```

Both returned `status=ready`, `backend=windows_elevated`, `runner_trusted=true`, `runner_version_matches=true`, `sandbox_users_ready=true`, `capabilities_ready=true`, and `wfp_ready=true`. Sandbox accounts and non-secret setup/capability markers were confirmed to exist. Credentials were not printed. The official launcher checked for an update and still selected the same version.

## Execution still failed

A real model was asked to call PowerShell once with only:

```powershell
Write-Output "MUSE_SHELL_OK"
```

The standard SDK `MuseClient.spawn` / `session.startSession` / `sendUserTurn` path reproduced the failure without extension code. The extension adapter and the installed VS Code chat reproduced it too. The tool reported:

```text
environment failure: sandbox enforcement unavailable:
windows_elevated setup_required:
windows elevated sandbox setup has not run
```

The command never started and no marker output was observed. Server logs associated with the MSP attempts reported `platform="none"`, `backend="unavailable"`, and `outcome="enforcement_unavailable"`. An explicit `--sandbox-network proxy-only` host argument did not resolve it. `serve --per-session` was separately refused on Windows because that mode requires Unix sockets.

The initial direct exec comparison inside the OneDrive profile timed out. Further testing separated two failures: MSP initialization reports sandbox unavailable (also reproduced with binary 1.4.14), while exec with `--enable-shell-tool` reaches the managed Windows sandbox but stalls inside the profile. Forced official update checking still selected 1.4.15-R8339.1.

## Verified legacy shell path and remaining ACL blocker

In a disposable `C:\muse-shell-test` workspace, real `muse exec --json --enable-shell-tool` commands succeeded without sandbox-disable flags. Tool output showed `muse-sbx-r1`, the expected working directory, a nonce read from a file whose contents were absent from the prompt, and a proof file matching that nonce. A separate command returned a real exit code 7 with its expected output. Sandbox diagnostics reported `windows_elevated`, restricted filesystem and proxy-only network. The controlled local PowerShell fixture needed a child-process `-ExecutionPolicy RemoteSigned`; the default sandbox account refused local scripts. No persistent execution policy was changed.

The extension now exposes this path as **Windows compatibility** mode. It uses existing Headless permission settings, rejects yolo, and explicitly permits resuming the host-validated workspace after exec canonicalizes its path to `\\?\C:\…`. Panel approvals/questions are unavailable in this mode. An installed VS Code run exposed that path-alias mismatch before the fix.

The profile's ancestor ACLs lacked the sandbox identities' traversal rights (two ancestors had ReadAttributes only). This matches the upstream [Windows traversal report](https://github.com/meta-models/muse-code-sdk/issues/26). After explicit user consent, the narrow repair below was applied and the OneDrive workspace command ran successfully. The clean external folder opens in VS Code Restricted Mode; its trust setting was not changed automatically.

`scripts/repair-windows-workspace-traverse.ps1` previews a proposed repair by default. For the local fixture it targets exactly the profile, OneDrive, Desktop, Projects and muse-code-work ancestors. It adds only non-inherited Traverse/ReadAttributes (plus Allow ACE Synchronize) for MuseSandboxUsers and the installed read-only capability SID. It grants no file-content access or write permission. Apply requires a new ACL backup path, and partial failures attempt guarded rollback. Symlinks/junctions/unknown reparse tags are rejected; known OneDrive CLOUD placeholders are accepted. See Microsoft's [reparse tag definitions](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-tags).

The local repair was applied after explicit approval of all five target paths, both identities and the proposed non-inherited rights. The original ACLs were backed up.

The initial Set-Acl process was stopped after it spent minutes processing existing child inheritance. The repair now uses `SetFileSecurityW` with DACL information only; Microsoft's [API contract](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setfilesecuritya) explicitly states that directory security applied through this API is not inherited by children. All five targets were then updated and inspected. Only the proposed explicit Traverse/ReadAttributes/Synchronize ACEs were added by this repair. A separate inheritable MuseSandboxUsers ReadAndExecute ACE on OneDrive was observed during the investigation, absent from the original backup and present before the target-only repair; it was preserved rather than overwritten. Muse's own read-refresh diagnostics also show profile ACL processing. Do not attribute this broader ACE to the target-only repair or claim it was removed.

## Installed VS Code acceptance (completed)

In `muse-test-ws`, using a new Windows compatibility editor chat:

- Real tool output identified `muse-sbx-r1` and the correct OneDrive working directory. A script read a nonce absent from the prompt and wrote a matching proof file.
- A controlled failure returned actual `exit code: 7`, stdout identity/cwd and `EXPECTED_EXIT_7`. The chat showed a failed tool badge and the actual exit code.
- A 60-second shell loop wrote a started marker and heartbeat once per second. Stop was clicked in the actual chat after tick 13. The matching PowerShell/Muse command processes disappeared, the heartbeat remained at 13 beyond the original completion time, and no completion marker appeared. The panel showed Stopped and restored Send.
- The same chat then ran another real shell command successfully. A newly generated nonce matched the new proof file, establishing recovery after Stop rather than reuse of the previous proof.
- The pre-existing `src/app.ts` SHA-256 remained unchanged. No yolo or sandbox-disable flag was used; no persistent PowerShell execution policy changed.

Two host-runtime limitations were exposed rather than hidden. Resuming an old Panel session through exec retained its stored prompt_unmatched policy despite the explicit disable-approval CLI flag, leaving an invisible approval wait; Stop ended it, and a new Windows chat worked. Separately, after the first successful command an orphan internal sandbox read-worker remained active and the next launch failed after 120 seconds on `Global\TbhWindowsSandboxAclPublication`. Windows mode now disables reminders (as the earlier direct CLI harness did). After the worker exited, the rebuilt/reloaded package passed exit 7, running-shell Stop and recovery in sequence. These results do not prove a general fix for Muse's global ACL lock or MSP runtime; keep both as upstream limitations and do not bypass sandbox enforcement to work around them.

The extension now prevents the incompatible mode transition before exec launches and offers explicit recovery while preserving the draft. Both recovery paths were validated separately from Windows shell execution; see [Session mode transitions](session-mode-transitions.md). This client-side guard does not fix MSP sandbox availability or the global ACL publication lock.

No sandbox-disable flags, fabricated success, manual account-password manipulation, or weakened filesystem/network permissions were used to conceal these failures. Keep this issue separate from working chat/file-tool/approval/question tests. A runtime fix should be accepted only after stdout, a controlled workspace file write, a real nonzero exit, and cancellation of a running shell all pass with sandboxing enabled.

## Minimal SDK reproduction

Run in a disposable folder with an installed, authenticated Muse binary. Set `MUSE_BINARY` to its actual executable path:

```js
import { MuseClient } from "@muse-code/sdk";
const client = await MuseClient.spawn({
  museBin: process.env.MUSE_BINARY,
  args: ["serve"],
  cwd: process.cwd(),
  clientInfo: { name: "windows_shell_repro", version: "1" },
});
try {
  const session = await client.startSession({
    workspaceRoot: process.cwd(), approvalMode: "promptUnmatched",
  });
  session.onApproval(async (request) => {
    console.log("Approval needs a user decision:", request.subject);
    // Connect your UI to an offered choice; do not auto-approve here.
    throw new Error("No interactive approval UI in this minimal reproduction");
  });
  const turn = await session.sendUserTurn({ input: [{ type: "text", text:
    'Use powershell exactly once to run Write-Output "MUSE_SHELL_OK". No other tools. Report the actual result.'
  }] });
  const stream = (async () => {
    for await (const item of turn.items()) {
      if (item.kind === "toolCall") console.log(item);
    }
  })();
  const [outcome] = await Promise.all([turn.completed, stream]);
  console.log(outcome);
} finally { await client.close(); }
```

Where policy requires approval, an interactive client must first offer and submit the user's choice; rejection is not a sandbox reproduction. The controlled live harness used the server's allow-once option for this exact harmless fixture command. The same sandbox error occurred after approval admission.
