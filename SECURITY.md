# Security

## Reporting a vulnerability

Please open a **private** security advisory on GitHub:

https://github.com/codemarc/muse-code/security/advisories/new

If that is unavailable, email the maintainer via the contact on https://github.com/codemarc (do not file a public issue with exploit details).

We aim to acknowledge reports within a few days.

## What this extension does

Muse CLI Chat is a thin VS Code / Cursor UI over Meta’s **Muse Code** CLI (`muse exec`). It:

- Spawns a local `muse` binary you install separately
- Passes your prompt and workspace path to that process
- Streams JSONL events back into a webview

It does **not** embed a model API client. Network calls, sandboxing, and tool execution are owned by the Muse CLI and Meta’s services.

## Trust boundaries (summary)

| Surface | Posture |
|---------|---------|
| Webview | CSP + nonce; transcript uses `textContent` (not HTML injection) |
| `muse exec` | `spawn` without a shell |
| Interactive terminal | Muse launched as `shellPath` (no shell string) |
| `executablePath` / `extraArgs` / `yolo` / `disableApproval` | Application-scoped; workspaces cannot override |
| `extraArgs` | Blocks `--yolo` and `--disable-sandbox` |
| Untrusted workspaces | Not supported |

## What we will not treat as a vulnerability

- Behavior of the Muse CLI itself (sandbox, approvals, model output). Report those to Meta.
- User enabling `muse.yolo` or `disableApproval` after explicit consent.
- Secrets present in the editor process environment that Muse inherits when you run it (same as any terminal agent).

## Related

- [PRIVACY.md](./PRIVACY.md) — what data can leave the machine
- [README.md](./README.md) — settings and safety defaults
