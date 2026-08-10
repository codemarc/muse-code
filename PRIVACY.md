# Privacy

Muse CLI Chat (unofficial) does **not** operate its own cloud backend and does **not** collect telemetry, analytics, or crash reports.

## What can leave your machine

When you send a prompt (and Muse is not using the echo test provider), the **Muse Code CLI** may send prompts, file contents, tool results, and related context to **Meta** under Meta’s terms for Muse Code / the Meta Model API. This extension only starts that CLI and shows its output.

Authentication uses credentials you already configured for Muse (`META_API_KEY`, `muse login`, or `muse auth set`). This extension reads `~/.config/muse/auth.json` only to detect whether credentials appear present (it does not upload that file).

## What stays local

- Extension settings in VS Code / Cursor
- Session id and selected multi-root folder in workspace state
- The sidebar transcript (ephemeral UI; Muse’s own session log is managed by the CLI)

## Third parties

- **Meta** — via the Muse Code CLI / Model API (see Meta’s product docs and privacy policy)
- **VS Code Marketplace / Open VSX** — if you install from those stores, their normal extension distribution applies

This extension is **not affiliated with Meta**. Review Meta’s documentation before use in workplaces with sensitive code or data.

## Contact

Privacy questions about **this wrapper**: GitHub issues or discussions on https://github.com/codemarc/muse-code  

Privacy questions about **Muse Code / Meta models**: Meta’s support and policy channels.
