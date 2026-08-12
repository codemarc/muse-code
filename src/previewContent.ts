/** Sniff, sanitize, and build canvas Preview HTML from tool output. */

import { isExecEnvelope } from "./toolResultFormat";

export type PreviewKind = "markdown" | "html" | "none";

export interface PreviewPayloadInput {
  resultRaw?: string;
  resultView?: string | null;
  execMeta?: { command?: string; description?: string };
}

export interface BuiltPreview {
  kind: PreviewKind;
  body: string;
  previewHtml: string | null;
  /** Path or URL suitable for openToolLink, if one primary doc path is found. */
  openExternallyHref: string | null;
}

const BLOCKED_SCHEME = /^(javascript|data|vbscript):/i;

export function sniffPreviewKind(
  text: string,
  hints?: { pathHint?: string },
): PreviewKind {
  const trimmed = text.trim();
  if (!trimmed) {
    return "none";
  }

  const pathHint = hints?.pathHint?.toLowerCase() ?? "";
  if (/\.(html?|htm)$/i.test(pathHint)) {
    return "html";
  }
  if (/\.md$/i.test(pathHint)) {
    return "markdown";
  }

  if (looksLikeHtml(trimmed)) {
    return "html";
  }

  if (looksLikeMarkdown(trimmed)) {
    return "markdown";
  }

  return "none";
}

export function previewBodyFromPayload(payload: PreviewPayloadInput): string {
  const raw = payload.resultRaw ?? "";
  const parsed = tryParseJson(raw);
  if (isExecEnvelope(parsed)) {
    return String(parsed.output ?? "");
  }
  if (payload.resultView) {
    return payload.resultView;
  }
  return raw;
}

export function buildPreviewFromPayload(
  payload: PreviewPayloadInput,
): BuiltPreview {
  const body = previewBodyFromPayload(payload);
  const pathHint = findPrimaryDocPath(body) ?? undefined;
  const kind = sniffPreviewKind(body, { pathHint });
  const previewHtml =
    kind === "none" ? null : buildPreviewHtml(body, kind);
  const openExternallyHref = findPrimaryDocPath(body);
  return { kind, body, previewHtml, openExternallyHref };
}

export function buildPreviewHtml(
  body: string,
  kind: Exclude<PreviewKind, "none">,
): string {
  const inner =
    kind === "markdown" ? markdownToHtml(body) : sanitizeHtmlFragment(body);
  return wrapPreviewDocument(inner);
}

export function sanitizeHtmlFragment(html: string): string {
  let out = html;
  // Remove forbidden elements including their contents where relevant.
  out = out.replace(
    /<(script|style|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  out = out.replace(
    /<\/?(?:script|style|iframe|object|embed|base|link|meta|form|input|button|textarea|select|svg|math|noscript)(?:\s[^>]*)?\/?>/gi,
    "",
  );
  // Strip event-handler attributes.
  out = out.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Neutralize blocked schemes in href/src/xlink:href/action/formaction.
  out = out.replace(
    /\s(href|src|xlink:href|action|formaction)\s*=\s*(["'])([^"']*)\2/gi,
    (_m, attr: string, quote: string, value: string) => {
      const v = value.trim();
      if (BLOCKED_SCHEME.test(v)) {
        return ` ${attr}=${quote}#${quote}`;
      }
      // v1: strip external / non-data images via src on img handled below.
      return ` ${attr}=${quote}${value}${quote}`;
    },
  );
  // Remove img tags with non-data src (external images stripped in v1).
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = /\bsrc\s*=\s*(["'])([^"']*)\1/i.exec(tag);
    if (!srcMatch) {
      return "";
    }
    const src = srcMatch[2].trim();
    if (/^data:image\//i.test(src)) {
      // Still strip on* already; keep data images only.
      return tag.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    }
    const altMatch = /\balt\s*=\s*(["'])([^"']*)\1/i.exec(tag);
    const alt = altMatch ? altMatch[2] : "";
    return alt ? escapeHtml(alt) : "";
  });
  return out;
}

/** Minimal Markdown → HTML (headings, fences, lists, quotes, links, emphasis). */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  let inUl = false;
  let inOl = false;
  let inBq = false;

  const closeLists = () => {
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
  };
  const closeBq = () => {
    if (inBq) {
      html.push("</blockquote>");
      inBq = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code
    const fence = /^```([\w-]*)\s*$/.exec(line);
    if (fence) {
      closeLists();
      closeBq();
      const lang = fence[1];
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      html.push(
        `<pre><code${cls}>${escapeHtml(code.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // Headings
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      closeLists();
      closeBq();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      closeLists();
      if (!inBq) {
        html.push("<blockquote>");
        inBq = true;
      }
      html.push(`<p>${inlineMd(line.replace(/^>\s?/, ""))}</p>`);
      i += 1;
      continue;
    }
    closeBq();

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      if (inOl) {
        html.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        html.push("<ul>");
        inUl = true;
      }
      html.push(`<li>${inlineMd(line.replace(/^[-*+]\s+/, ""))}</li>`);
      i += 1;
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      if (inUl) {
        html.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        html.push("<ol>");
        inOl = true;
      }
      html.push(`<li>${inlineMd(line.replace(/^\d+\.\s+/, ""))}</li>`);
      i += 1;
      continue;
    }

    closeLists();

    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    // Paragraph: gather consecutive non-empty non-special lines
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^[-*+]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    html.push(`<p>${inlineMd(para.join(" "))}</p>`);
  }

  closeLists();
  closeBq();
  return html.join("\n");
}

export function findPrimaryDocPath(text: string): string | null {
  const matches = text.match(
    /(?:https?:\/\/[^\s<>"']+\.(?:html?|htm|md)|\/[\w./~-]+\.(?:html?|htm|md)|file:\/\/[^\s<>"']+\.(?:html?|htm|md))/gi,
  );
  if (!matches || matches.length === 0) {
    return null;
  }
  // Prefer a single clear path; if many, use the first.
  return matches[0];
}

function looksLikeHtml(trimmed: string): boolean {
  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return true;
  }
  if (/^<(head|body|div|main|article|section|table|h[1-6])[\s>]/i.test(trimmed)) {
    return true;
  }
  const firstLine =
    trimmed.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
  if (/^<[a-z][\w:-]*(\s|>|\/)/i.test(firstLine) && /<\/[a-z][\w:-]*>/i.test(trimmed)) {
    return true;
  }
  return false;
}

function looksLikeMarkdown(trimmed: string): boolean {
  // Require 2+ signals. A lone `# shell comment` must not qualify.
  let signals = 0;
  if (/^#{1,6}\s+\S.+$/m.test(trimmed)) {
    signals += 1;
  }
  if (/^```/m.test(trimmed)) {
    signals += 2;
  }
  const listHits = trimmed.match(/^[-*+]\s+\S/gm);
  if (listHits && listHits.length >= 2) {
    signals += 1;
  }
  const orderedHits = trimmed.match(/^\d+\.\s+\S/gm);
  if (orderedHits && orderedHits.length >= 2) {
    signals += 1;
  }
  const bqHits = trimmed.match(/^>\s?\S/gm);
  if (bqHits && bqHits.length >= 2) {
    signals += 1;
  }
  if (/\[[^\]]+\]\([^)]+\)/.test(trimmed)) {
    signals += 1;
  }
  return signals >= 2;
}

function inlineMd(text: string): string {
  let s = escapeHtml(text);
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const href = url.trim();
    if (BLOCKED_SCHEME.test(href)) {
      return label;
    }
    return `<a href="${escapeAttr(href)}">${label}</a>`;
  });
  // Bold **text** or __text__
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic *text* or _text_
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  s = s.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");
  // Inline code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

function wrapPreviewDocument(bodyInner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 16px 20px 32px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    max-width: 52rem;
    color: #1a1a1a;
    background: #fff;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e8e8e8; background: #1e1e1e; }
    a { color: #6cb6ff; }
    code, pre { background: #2a2a2a; }
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 0.5em; }
  p, ul, ol, blockquote { margin: 0.6em 0; }
  a { color: #0066cc; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.92em;
    padding: 0.1em 0.35em;
    border-radius: 3px;
    background: #f2f2f2;
  }
  pre {
    padding: 12px;
    overflow: auto;
    border-radius: 6px;
    background: #f2f2f2;
  }
  pre code { padding: 0; background: transparent; }
  blockquote {
    margin-left: 0;
    padding-left: 12px;
    border-left: 3px solid #ccc;
    opacity: 0.95;
  }
  img { max-width: 100%; }
</style>
</head>
<body>
${bodyInner}
</body>
</html>`;
}

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
