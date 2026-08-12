---
name: Canvas Preview — Phase 3
overview: Add a canvas-only Preview mode that renders Markdown and HTML tool output in a sandboxed iframe, reusing openToolLink. No sidebar Preview, no scripts in preview, no new display setting.
todos:
  - id: sniff-sanitize
    content: Pure sniff (md|html|none) + HTML sanitize + MD→HTML helpers with unit tests
    status: pending
  - id: preview-host
    content: Canvas Preview toggle + sandboxed iframe host; CSP/srcdoc; link intercept → openLink
    status: pending
  - id: payload-body
    content: Pass previewBody (exec output-only) in canvasData; hide Preview when sniff is none
    status: pending
  - id: tests-docs
    content: Unit tests, manual F5, README/CHANGELOG, version bump
    status: pending
isProject: false
---

# Canvas Preview — Phase 3 Plan

## Goal

Ship the deferred Markdown/HTML preview for the Phase-2 canvas: a third **Preview** mode beside Readable / Raw so reports and write-ups are readable as documents, not only as monospace text. Sidebar cards stay compact text; Preview is canvas-only.

## Success Criteria

- Canvas shows **Preview** when sniff says `markdown` or `html`; hidden otherwise. Clicking it renders in a full-height sandboxed iframe.
- Markdown: MD → sanitized HTML → same iframe path as HTML.
- HTML: sanitize (strip scripts, event handlers, `javascript:`/`data:` URLs) → iframe `srcdoc`. Never `allow-scripts`.
- Exec envelopes preview **`output` only**; header still shows description/command + exit badge.
- In-preview link clicks go through existing `openToolLink` (same as Readable linkify). External “Open” for `.html` paths still works.
- Readable / Raw / Copy unchanged. `muse.toolOutputFormat` unchanged (no `markdown`/`html` enum value). Preview is a per-panel transient override.
- `bun test` + `bun run check` + `vsce package` green. No regression to Phase-1 cards or Phase-2 canvas text modes.

## Context And Current Facts

- Phase 1 (`0.1.10`/`0.1.11`): `toolResultFormat`, Readable/Raw cards, `LINK_RE` + `openToolLink`.
- Phase 2 (`0.1.12`): `src/canvasPanel.ts` singleton WebviewPanel; `media/canvas.{js,css}`; payload `{name, resultRaw, resultView, execMeta}`; modes Readable/Raw/Copy; CSP `default-src 'none'; style-src cspSource; script-src nonce`.
- Explicit non-goal in Phase 1/2 plans: “Markdown/HTML preview rendering inside panel.” This plan is that deferred work.
- Exec envelope fields: `command`, `description`, `exit_code`, `output`, `truncated` (`src/toolResultFormat.ts`). Transcript cap `MAX_TOOL_CACHE_CHARS=32000`.
- `media/*` not bundled by esbuild; served via `asWebviewUri`. Prefer zero or one small vendor file under `media/` over npm runtime deps in the extension host unless already justified.

## Constraints And Non-goals

- **Reuse:** `openToolLink` / `classifyToolLink` stay single-source. No second link opener.
- **No new settings:** do not extend `muse.toolOutputFormat`. Preview is canvas UI only.
- **Security:** Preview content is untrusted tool output. Sandboxed iframe without `allow-scripts`. Sanitize before `srcdoc`. Blocked schemes unchanged.
- **Non-goals:** sidebar Preview; streaming into iframe; remote URL fetch as document body; `allow-scripts` / interactive JS reports; annotation/drawing marks; multi-panel history; changing `muse exec` JSONL shapes; full HTML fidelity (forms, service workers, etc.).

## Key Decisions

| Decision | Recommended | Why | Alternative rejected |
|---|---|---|---|
| One Preview button | Single **Preview** mode; sniff picks md vs html renderer | Avoids mode clutter; user mental model is “document view” | Separate Markdown / HTML toggles |
| Where Preview lives | Canvas only | Sidebar height/CSP already constrained; Phase-2 intent | Sidebar Preview card |
| MD + HTML pipe | Both land in one sandboxed iframe after sanitize | One host, one CSP story, one link intercept | MD as `innerHTML` in parent webview (weaker isolation) |
| Exec body | Preview `output` field when envelope; else full text | `$ cmd` / `exit` chrome belongs in header, not the document | Preview entire Readable blob |
| Sniff | Pure `sniffPreviewKind(text, hints?) → "markdown" \| "html" \| "none"` | Testable; hide button when `none` | Always show Preview and fail awkwardly |
| Scripts in HTML | Strip; iframe `sandbox=""` (no tokens) or `sandbox="allow-popups-to-escape-sandbox"` never scripts | Tool HTML must not run in IDE webview | `allow-scripts` for “real” reports |
| MD library | Small vendored or zero-dep subset (headings, lists, fences, links, emphasis) under `media/` or `src/` with tests | Keeps package lean; extension already avoids heavy webview bundling | Pull full `marked`+`DOMPurify` npm into host without size/CSP plan |
| Default mode | Still Readable/Raw from `muse.toolOutputFormat`; never auto-switch to Preview | Surprising for `ls` / compiler logs even if sniff false-positives | Auto-Preview when sniff hits |

## Recommended Approach

```
canvasData (+ previewBody, previewKind)
  → media/canvas.js
       Readable / Raw  → existing <pre> + linkify
       Preview         → sanitize(mdToHtml|html) → iframe.srcdoc
            link click → postMessage(openLink) → openToolLink
```

Host (`canvasPanel`) stays thin: pass enough text for sniff + render. Prefer computing `previewBody` / `previewKind` in pure TS (`src/previewContent.ts`) so unit tests cover sniff/sanitize without a webview; canvas.js only displays what the host sends (or re-sniffs identically if we pass body only — prefer host sends `previewKind` + `previewHtml` already sanitized to keep dangerous HTML out of dual implementations).

**Preferred split:** host builds `previewHtml: string | null` (null ⇒ hide Preview). Webview never parses MD/HTML itself beyond assigning `iframe.srcdoc`. That keeps sanitizer in one place (testable Node/bun).

## Work Plan

### 1. `src/previewContent.ts` — sniff + sanitize (+ MD) (unblocks 2–3)

- `sniffPreviewKind(text: string): "markdown" | "html" | "none"`
  - **html:** trimmed starts with `<!DOCTYPE` / `<html` / `<head` / `<body`, or first non-empty line looks like a top-level HTML tag; or hint path ends in `.html`/`.htm`.
  - **markdown:** ATX headings, fenced \`\`\`, or multiple lines matching list/blockquote patterns; or hint path ends in `.md`.
  - Prefer html over markdown when both could match (`<h1>` alone is html).
- `previewBodyFromPayload(payload): string` — if `resultRaw` parses as exec envelope, return `output`; else `resultView || resultRaw`.
- `buildPreviewHtml(body, kind): string | null` — markdown via small converter; html via sanitizer; wrap MD result in minimal `html/head/body` with neutral CSS (system font, readable measure). Sanitize all: remove `script`, `iframe`, `object`, `embed`, `base`; strip `on*` attributes; neutralize `href`/`src` with blocked schemes.
- Unit tests in `src/previewContent.test.ts` (fixtures: sample exec MD report, minimal HTML doc, `ls` output → none, `javascript:alert` stripped).

### 2. Canvas Preview host UI

- `canvasPanel.getHtml`: add Preview toggle + `<iframe id="preview" class="canvas-preview" sandbox="" hidden></iframe>` beside/under the existing `<pre>`.
- CSP: keep parent tight. `srcdoc` content is owned by iframe; do **not** broaden parent `script-src`. If `srcdoc` needs images from https, prefer stripping remote images in v1 (or allow `img-src https:` only inside a documented follow-up). **v1: strip `<img src>` that are not `data:` after sanitize, or replace with alt text** to avoid CSP creep — decide in implementation: default **strip external images** for v1.
- `media/canvas.js`: on `canvasData`, if `previewHtml` set, show Preview button; on click set mode `preview`, hide `pre`, show iframe and set `srcdoc`. Readable/Raw hide iframe.
- Link intercept: inject a tiny `<base>`-free click listener via… **cannot run scripts in sandbox=""**. So either:
  - (A) `sandbox="allow-scripts"` with only our injected bootstrap (bad: page scripts might remain if sanitize fails), or
  - (B) leave links inert in iframe and rely on “Open in browser” for files, or
  - (C) rewrite `a[href]` at sanitize time to `href` kept as text decoration and… still not clickable without scripts, or
  - (D) `sandbox="allow-popups allow-popups-to-escape-sandbox"` still needs user gesture navigation — top-level navigations may be blocked.

**Lock-in for links in Preview:** sanitize keeps safe `http(s)` and path-like hrefs as real anchors. Use `sandbox="allow-popups allow-popups-to-escape-sandbox"` **without** `allow-scripts` so default link behavior cannot run JS; document that **in-iframe navigation may be blocked by VS Code**, and add canvas toolbar **Open preview source** only when `execMeta`/body contains a resolvable `.html`/`.md` path (reuse `openToolLink`). Optionally Phase 3.1: `sandbox="allow-scripts"` with sanitizer guaranteeing no author scripts + injected `click`→`postMessage` bridge via `vscode` — **out of v1** unless allow-scripts+bootstrap proves necessary in F5.

Simplest v1 that still feels good: Preview is visual read; Copy copies source body; existing linkify remains on Readable/Raw; toolbar button “Open externally” when a single primary `.html`/`.md` path is detected in body.

### 3. Payload wiring

- Extend `CanvasPayload` / `postCanvasData` with `previewHtml: string | null` (and optionally `previewKind` for UI label).
- Compute in `CanvasPanel.show` / `postCanvasData` via `previewContent.ts` from `resultRaw`/`resultView`/`execMeta`.
- `media/chat.js`: no Preview on sidebar cards (unchanged). Open in canvas still sends same payload; host derives preview.

### 4. Tests, docs, validation

- `bun test src/` including new `previewContent.test.ts`.
- Manual F5: echo/provider or fixture-like tool result with MD body → Preview renders headings; HTML body → Preview; `ls` → no Preview button; sanitize fixture with `<script>alert(1)</script>` → not executable; Readable/Raw unaffected.
- README: one line under History/canvas — Preview renders Markdown/HTML in the canvas (sandboxed).
- CHANGELOG + version patch (`0.1.13`).

## Validation Plan

| Unit | Check | Expected |
|---|---|---|
| Sniff | unit tests | md / html / none cases green |
| Sanitize | unit tests | script/onerror/javascript: removed |
| Types/build | `bun run check` && package | vsix contains unchanged `media/canvas.*` updates |
| Manual | F5 Preview MD + HTML + none | iframe shows; no script execution; toggles restore pre |
| Regression | Open in canvas from history card | previewHtml derived from enriched raw |

## Risks / Rollback

- **Risk:** False-positive sniff on shell output with `#` comments. Mitigate with multi-signal sniff (require 2+ md signals or path hint).
- **Risk:** Sanitize gaps. Mitigate with iframe `sandbox` without scripts; defense in depth.
- **Risk:** VS Code blocks `srcdoc` or iframe. Mitigate: feature-detect; on failure show warning and keep Readable.
- **Rollback:** Remove Preview button + `previewHtml` field; text canvas unchanged.

## Open Questions

- None blocking. Locked: unified Preview, canvas-only, sandboxed, no new setting, exec `output`-only, strip/avoid author scripts, external images stripped in v1, in-iframe link navigation best-effort with Open externally escape hatch.
