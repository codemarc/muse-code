---
name: Canvas Panel — Phase 2
overview: Add "Open in canvas" to each tool-result card; open a full-size WebviewPanel beside the editor that reuses the Phase-1 formatter and link handler. No markdown preview, no streaming, no CLI shape change.
todos:
  - id: panel-host
    content: Create CanvasPanel singleton (WebviewPanel lifecycle, config sync, openLink reuse)
    status: completed
  - id: canvas-assets
    content: Add media/canvas.{html,js,css} reusing Readable/Raw toggle + LINK_RE linkify at full height
    status: completed
  - id: wire-open
    content: Wire chat card "Open in canvas" → host → panel show/reveal
    status: completed
  - id: tests-docs
    content: Unit + manual validation, README/CHANGELOG, package.json contributes
    status: completed
isProject: false
---

# Canvas Panel — Phase 2 Plan

## Goal

Ship Phase 2 deferred from `readable_tool_output_41a2815c` — a true side-panel canvas so large `muse exec` shell outputs (HTML reports, long stdout) are readable outside the narrow sidebar. Inline card stays compact; **Open in canvas** opens a `WebviewPanel` beside the editor with the same Readable/Raw view and same clickable URLs/file paths.

## Success Criteria

- Each tool card in `media/chat.js` shows **Open in canvas** when it has content. Click opens (or reveals) a `WebviewPanel` titled by tool description/command, painted with the same `resultView`/`resultRaw` as the sidebar.
- Canvas has Readable / Raw toggle (default follows `muse.toolOutputFormat`) and full-height scroll — no 320px cap from `media/chat.css:tool-body`. Expands beyond `PREVIEW_CHARS=800` / `EXPANDED_CHARS=8000` limits used in sidebar.
- Clicking `https://…`, `file://…`, or absolute `/…/.html` in canvas opens via same path as sidebar: `vscode.env.openExternal` (HTML → system browser), fallback `vscode.open`; `javascript:`/`data:` blocked. Workspace-relative paths resolve via `WorkspaceFolderStore`.
- Setting `muse.toolOutputFormat` syncs to both sidebar and canvas without reload. Panel survives `onDidChangeViewState` (reveal, don't recreate needlessly).
- `bun test` + `bun run check` + `vsce package` green. No regression to inline cards / history hydrate.

## Context And Current Facts

- Phase 1 shipped 0.1.10/0.1.11: `src/toolResultFormat.ts` (`isExecEnvelope`, `formatExecEnvelope`, `formatToolResult`, `ExecMeta`), wired in `src/museJsonl.ts:recordToUiEvent` for `tool.result` and re-derived in `src/chatViewProvider.ts:enrichItemForWebview` for history. Stored as `resultRaw` (32k cap) in `src/transcript.ts`; `resultView` derived at paint.
- Link handling: `src/linkTarget.ts:classifyToolLink`/`resolveToolLinkPath` (pure), `src/openLink.ts:openToolLink`/`resolveToolLinkUri` (tested in `src/linkTarget.test.ts` + `src/openLink` path). `chatViewProvider.ts:handleOpenLink` calls `openToolLink(href, folder.uri)`. `media/chat.js:LINK_RE` safely linkifies via `createTextNode` + `a.tool-link` + `postMessage({type:"openLink",href})`.
- Sidebar webview: `ChatViewProvider` singleton, `resolveWebviewView` sets `localResourceRoots: [media]`, `getHtml()` uses CSP nonce, `postConfig()` pushes `toolOutputFormat`. Inline card logic in `media/chat.js:addToolCard` (header label, `tool-exit` badge, `Readabl e`/`Raw` toggles, `collapsePreview`, `Expand`).
- Build: `esbuild.mjs` bundles `src/extension.ts` → `dist/extension.js` (external `vscode`); `media/*` served via `webview.asWebviewUri`, not bundled. `package.json` `contributes.views.muse` + `commands` + `configuration.muse.toolOutputFormat`.
- No `WebviewPanel` exists yet (grep `WebviewPanel` only in `node_modules/@types/vscode`). No `media/canvas.*`. `.agents/plans` is not writable in this sandbox (Operation not permitted); durable plan lives at `.cursor/plans/` per existing `readable_tool_output_41a2815c.plan.md`.

## Constraints And Non-goals

- **Reuse, don't fork:** formatter (`toolResultFormat`), link classifier, and `openToolLink` stay single-source. Canvas imports same CSS tokens (`--vscode-*`) for theme consistency.
- **No new settings:** `muse.toolOutputFormat` remains the single display setting; canvas toggle is per-panel transient override, not persisted.
- **Non-goals (explicitly out, per Phase-1 plan):** Markdown/HTML preview rendering inside panel; streaming partial `stdout` (still one-shot `tool.result`); changing `muse exec` JSONL shapes; multi-panel tab history (single singleton panel, last-opened wins, `reveal` if already visible).
- **Security:** CSP `default-src 'none'; style-src ${cspSource}; script-src 'nonce-…'` copied from `chatViewProvider.getHtml`. `BLOCKED_SCHEME = /^(javascript|data|vbscript):/i` enforced via `classifyToolLink`. `file:` URIs only via `vscode.Uri.file`, not string concat.
- **Compatibility:** `vscode@^1.85.0`, macOS/Linux only (`platform.ts:isSupportedPlatform`), untrusted workspaces unsupported (existing declaration).

## Key Decisions

| Decision | Recommended | Why | Alternative rejected |
|---|---|---|---|
| Panel ownership | New `src/canvasPanel.ts` singleton `CanvasPanel` owned by `extension.ts`, injected with `extensionUri` + `WorkspaceFolderStore` | Mirrors `ChatViewProvider` pattern, keeps `ChatViewProvider` focused on sidebar; enables `onDidChangeConfiguration` + `onDidChangeViewState` lifecycle without circular dep | Adding panel methods directly to `ChatViewProvider` — bloats 700-line class, mixes sidebar + panel concerns |
| Panel count | Single instance, `reveal()` if exists, `create` otherwise | Matches VS Code "Output" / "Canvas" UX; avoids tab spam; Phase-1 plan says "true canvas panel" singular | One panel per tool card — tabs accumulate, hard to dispose, no value until proven |
| Data passed | Full `FormattedToolResult` (`resultRaw`, `resultView`, `execMeta`) + `name` via `postMessage` | Already computed in `enrichItemForWebview`; no re-parse; canvas can toggle without host round-trip | Pass only `resultRaw` and re-format in panel — duplicates logic, risks drift |
| Trigger | Button on each `tool-card` in `media/chat.js` (`Open in canvas`) → `vscode.postMessage({type:"openCanvas", payload})` → host → `CanvasPanel.show(payload)` | Least surprise, same place as `Readable`/`Raw` toggles; no command-palette indirection needed for primary flow | Only command-palette `Muse: Open Last Tool Result in Canvas` — discoverability poor for per-card action |
| Config sync | Host `postConfig()` pushes to both `chatView` and `canvasPanel.webview` on `muse.toolOutputFormat` change | Single `workspace.onDidChangeConfiguration` handler in `extension.ts` already exists | Poll in webview — wasteful, out of sync |

## Recommended Approach

Create a thin `CanvasPanel` that is **mostly a larger host for the existing card** (Phase-1 plan wording). No new parsing, no new link classification, no new storage.

Flow:

```
tool.result JSONL → museJsonl.formatToolResult → chatViewProvider.handleEvent/enrichItemForWebview
  → media/chat.js addToolCard (compact, 320px, Preview/Expand)
       —click Open in canvas→ postMessage(openCanvas) → ChatViewProvider → CanvasPanel.show(formatted)
           → media/canvas.js (full-height, same Readable/Raw toggle, same LINK_RE → postMessage openLink → openToolLink)
```

Reuse `openLink.ts` for both surfaces — `ChatViewProvider.handleOpenLink` stays the single `vscode.env.openExternal`/`vscode.open` entry point; `CanvasPanel` delegates to it (or shares a small `handleCanvasMessage` that calls same function) to avoid duplicating `WorkspaceFolderStore` resolution.

## Work Plan

### 1. `src/canvasPanel.ts` — panel host (depends on nothing, unblocks 2–3)
- Singleton class `CanvasPanel` with `static createOrShow(extensionUri, workspaceFolderStore)` + `show(data: {name, resultRaw, resultView, execMeta})` + `dispose()`.
- Holds `vscode.WebviewPanel | undefined`, `currentData`, `toolOutputFormat` cache.
- `getHtml(webview)` clones `chatViewProvider.getHtml` CSP/nonce pattern; points to `media/canvas.js` + `media/canvas.css`; `enableScripts:true`, `localResourceRoots:[media]`, `retainContextWhenHidden:true`.
- `webview.onDidReceiveMessage` handles `{type:"openLink", href}` → `openToolLink(href, folder.uri)` (import from `src/openLink.ts`) and `{type:"ready"}` → `post({type:"canvasData", ...currentData, toolOutputFormat})`.
- `onDidChangeViewState` + `onDidDispose` cleanup; `postConfig(format)` updates panel if visible.
- Register `vscode.window.onDidChangeActiveColorTheme` no-op (panel inherits CSS vars).
- ~120 lines. No new npm deps.

### 2. `media/canvas.js` + `media/canvas.css` (+ HTML via `canvasPanel.getHtml`)
- `canvas.css` copies `chat.css` tokens but `tool-body`-equivalent is `height: 100%; max-height: none; overflow:auto;` full viewport. Reuses `.tool-header`, `.tool-exit`, `.tool-toggle.active`, `.tool-link`.
- `canvas.js` on DOMContentLoaded: `vscode = acquireVsCodeApi()`, `postMessage({type:"ready"})`, listen `window.addEventListener("message", ...)`.
- On `canvasData`: render header (label from `execMeta.description || command || name`, `exitCode` badge), `Readable`/`Raw` toggles (active state follows `toolOutputFormat` unless user clicked), `pre.tool-body` with `linkifyInto(body, activeText())` — same `LINK_RE` as `chat.js` (extract to shared `media/linkify.js` or duplicate 1 regex + `linkifyInto` function; duplicate is cheaper than new bundle step given `media/*` aren't bundled).
- No preview truncation: show full `resultView`/`resultRaw` with `max-height:none`; still cap at `MAX_TOOL_CACHE_CHARS=32000` already enforced in `transcript.ts` — no additional limit needed. Add `Copy` button (`navigator.clipboard.writeText(activeText())` inside webview — allowed; fallback `postMessage` if denied).
- Handles `config` message to flip default when user hasn't manually toggled.

### 3. Wire sidebar → canvas
- `src/chatViewProvider.ts`: inject `CanvasPanel` (constructor param or import singleton). In `resolveWebviewView`'s `onDidReceiveMessage`, add `case "openCanvas": CanvasPanel.show(msg.payload); break;`.
- `media/chat.js`: in `addToolCard`, after `actions` (Readable/Raw), insert `openInCanvasBtn = button.tool-toggle "Open in canvas"`; `onclick → vscode.postMessage({type:"openCanvas", payload:{name:data.name, resultRaw:data.resultRaw, resultView:data.resultView, execMeta:data.execMeta})})`. Hide if no `resultRaw`/`resultView` (shouldn't happen, but keep).
- `src/extension.ts`: instantiate `CanvasPanel` singleton, pass `extensionUri` + `folders`; in `onDidChangeConfiguration` for `muse.toolOutputFormat`, call `provider.postConfig()` (exists) + `canvasPanel.postConfig(format)`; add `vscode.commands.registerCommand("muse.openInCanvas", () => canvasPanel.reveal())` for palette access; add to `context.subscriptions`.
- `package.json`: add `command muse.openInCanvas` (`title: "Muse CLI Chat: Open Last Tool Result in Canvas"`, `icon: $(open-preview)`), add to `menus.view/title` if desired (optional), no new `configuration`.

### 4. Tests, docs, validation
- Unit: no new pure logic — formatter/link already covered. Add one test in `src/linkTarget.test.ts` or new `src/canvasPanel.test.ts` that `CanvasPanel` delegates `openLink` via `classifyToolLink` (optional, low value). Prefer manual validation.
- `bun test src/` + `bun run check` (tsc) + `bun run compile:prod` + `bunx vsce package --no-dependencies` — same CI as `.github/workflows/ci.yml`.
- Manual: F5 Extension Development Host, set `muse.useEchoProvider:true`, send prompt that triggers `tool.result` with sample exec (`fixtures/echo_basic.jsonl` shape), verify inline card + `Open in canvas` → panel opens beside editor → Readable/Raw toggle → `https://example.com` + `/tmp/report.html` → `openExternal` / editor; change `muse.toolOutputFormat` in Settings → both surfaces flip default; close/reopen panel → `reveal` not duplicate.
- Docs: `README.md` Settings table already has `toolOutputFormat`; add one line under History/Tool Output: "Open in canvas shows full output beside the editor." `CHANGELOG.md` 0.1.12 entry. `package.json` version bump.

## Validation Plan

| Unit | Command / Check | Expected evidence |
|---|---|---|
| Types | `bun run check` | `tsc --noEmit` 0 errors (new `canvasPanel.ts` imports `vscode`, `openLink`, `toolResultFormat:ExecMeta`) |
| Tests | `bun test src/` | Existing `linkTarget`, `toolResultFormat`, `museJsonl`, `museSessions` pass; no new failures |
| Build | `bun run compile:prod && bunx vsce package --no-dependencies` | Produces `muse-cli-chat-0.1.12.vsix`, no `media/canvas.*` missing errors (they're `localResourceRoots` runtime, not bundled — verify `vsix` contains `media/canvas.js` via `unzip -l`) |
| Manual F5 | Host: `muse.useEchoProvider:true` → send "run ls" → click Open in canvas | Panel opens `ViewColumn.Beside`, full stdout visible without `…`, toggle flips, links clickable (check `vscode.env.openExternal` called for `https:`) |
| Config sync | Change `muse.toolOutputFormat` while panel open | Panel's active toggle follows setting unless user overrode per-panel |
| History | `Resume Session` with prior tool result → Open in canvas from history card | Same `enrichItemForWebview` path works for hydrated items |

Highest-risk check: WebviewPanel ↔ extension message passing (`postMessage`/`onDidReceiveMessage`) + `openLink` delegation — if broken, canvas shows but links silently fail. Verify with `console.log` in `canvas.js` + `openToolLink` return boolean warning ("Could not open link" already in `chatViewProvider.ts`).

## Risks / Rollback

- **Risk:** Two webviews posting `openLink` could collide if `ChatViewProvider.handleOpenLink` assumes `this.view` context. Mitigated by keeping handler pure (`openToolLink(href, folder.uri)`) not `this.view.webview`-bound.
- **Risk:** Panel singleton leak on extension deactivate. Mitigated by `context.subscriptions.push(canvasPanel)` and `onDidDispose → panel=undefined`.
- **Risk:** `media/canvas.js` duplication of `LINK_RE`/`linkifyInto` drifts. Mitigated by copying verbatim from `media/chat.js:12` and adding comment `// keep in sync with chat.js:LINK_RE`.
- **Rollback:** Remove `src/canvasPanel.ts` import + `package.json` command + `chat.js` button; inline cards keep working (no data model change). Version bump is patch; no migration.

## Open Questions

- None blocking. One product nuance to confirm before code: should canvas `Copy` copy `resultView` or `resultRaw`? Propose copy active view (matches toggle), same as `Readable`/`Raw` mental model.
