/** Sniff, sanitize, and build canvas Preview HTML from tool output or files. */

import { basename } from "node:path";
import { isExecEnvelope } from "./toolResultFormat";

export type PreviewKind =
  | "markdown"
  | "html"
  | "json"
  | "yaml"
  | "toon"
  | "csv"
  | "text"
  | "none";

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

/** Extensions that can open as a canvas file chip. Longest alternative first. */
const DOC_EXT_ALT = "markdown|md|html?|jsonl?|ya?ml|toon|csv|tsv|txt|xlsx?";

/** A trailing extension must end the word so `.jsonl` never matches as `.json`. */
export const CANVAS_FILE_EXT_RE = new RegExp(`\\.(?:${DOC_EXT_ALT})$`, "i");

/**
 * A local path must start at a token boundary, so a relative path keeps its
 * first segment (`docs/STATUS.md`, not `/STATUS.md`) and a path fragment inside
 * a placeholder like `<root>/…/session.jsonl` is not mistaken for a real one.
 * Absolute, `~/`, `./`, `../`, and workspace-relative forms all match.
 */
const LOCAL_PATH_SOURCE = `(?<![\\w.~/-])/?(?:[\\w.~-]+/)*[\\w.~-]+`;

/** Same, but the path must name a directory, so a bare `file.txt` in `ls`
 * output is not mistaken for a document reference. */
const LOCAL_DIR_PATH_SOURCE = `(?<![\\w.~/-])(?:/(?:[\\w.~-]+/)*|(?:[\\w.~-]+/)+)[\\w.~-]+`;

const SCHEME_PATH_SOURCE = `(?:https?://|file://)[^\\s<>"']+`;

const DOC_EXT_TAIL = `\\.(?:${DOC_EXT_ALT})(?![A-Za-z0-9])`;

const DOC_PATH_SOURCE = `(?:${SCHEME_PATH_SOURCE}|${LOCAL_PATH_SOURCE})${DOC_EXT_TAIL}`;

const DIR_DOC_PATH_SOURCE = `(?:${SCHEME_PATH_SOURCE}|${LOCAL_DIR_PATH_SOURCE})${DOC_EXT_TAIL}`;

function docPathRe(): RegExp {
  return new RegExp(DOC_PATH_SOURCE, "gi");
}

export function kindFromPath(filePath: string): PreviewKind {
  const base = basename(filePath).toLowerCase();
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
  switch (ext) {
    case ".md":
    case ".markdown":
      return "markdown";
    case ".html":
    case ".htm":
      return "html";
    case ".json":
      return "json";
    case ".jsonl":
    case ".txt":
      return "text";
    case ".yml":
    case ".yaml":
      return "yaml";
    case ".toon":
      return "toon";
    case ".csv":
    case ".tsv":
      return "csv";
    case ".xls":
    case ".xlsx":
      return "none";
    default:
      return "none";
  }
}

export function chipLabelForKind(kind: PreviewKind, filePath?: string): string {
  const ext = filePath
    ? (basename(filePath).split(".").pop() ?? "").toUpperCase()
    : "";
  if (/^XLSX?$/.test(ext)) {
    return `Spreadsheet · ${ext}`;
  }
  if (ext) {
    return `Document · ${ext}`;
  }
  switch (kind) {
    case "markdown":
      return "Document · MD";
    case "html":
      return "Document · HTML";
    case "json":
      return "Document · JSON";
    case "yaml":
      return "Document · YAML";
    case "toon":
      return "Document · TOON";
    case "csv":
      return "Document · CSV";
    case "text":
      return "Document · TXT";
    case "none":
      return "Document";
  }
}

export function sniffPreviewKind(
  text: string,
  hints?: { pathHint?: string },
): PreviewKind {
  const trimmed = text.trim();
  if (!trimmed) {
    return "none";
  }

  const pathHint = hints?.pathHint ?? "";
  if (pathHint) {
    const fromPath = kindFromPath(pathHint);
    if (fromPath !== "none") {
      return fromPath;
    }
  }

  if (looksLikeHtml(trimmed)) {
    return "html";
  }

  if (looksLikeJson(trimmed)) {
    return "json";
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

export function buildPreviewFromSource(
  source: string,
  kind: PreviewKind,
): BuiltPreview {
  if (kind === "none") {
    return {
      kind: "none",
      body: source,
      previewHtml: null,
      openExternallyHref: null,
    };
  }
  return {
    kind,
    body: source,
    previewHtml: buildPreviewHtml(source, kind),
    openExternallyHref: null,
  };
}

export function buildPreviewHtml(
  body: string,
  kind: Exclude<PreviewKind, "none">,
): string {
  let inner: string;
  switch (kind) {
    case "markdown":
      inner = markdownToHtml(body);
      break;
    case "html":
      inner = sanitizeHtmlFragment(body);
      break;
    case "json":
      inner = `<pre><code>${escapeHtml(prettyJson(body))}</code></pre>`;
      break;
    case "csv":
      inner = csvToHtmlTable(body);
      break;
    case "yaml":
    case "toon":
    case "text":
      inner = `<pre><code>${escapeHtml(body)}</code></pre>`;
      break;
  }
  return wrapPreviewDocument(inner);
}

/** Host-sanitized Markdown HTML for sidebar assistant messages (fragment only). */
export function buildChatMarkdownHtml(md: string): string {
  return sanitizeHtmlFragment(markdownToHtml(md));
}

export function sanitizeHtmlFragment(html: string): string {
  let out = html;
  out = out.replace(
    /<(script|style|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  out = out.replace(
    /<\/?(?:script|style|iframe|object|embed|base|link|meta|form|input|button|textarea|select|svg|math|noscript)(?:\s[^>]*)?\/?>/gi,
    "",
  );
  out = out.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(
    /\s(href|src|xlink:href|action|formaction)\s*=\s*(["'])([^"']*)\2/gi,
    (_m, attr: string, quote: string, value: string) => {
      const v = value.trim();
      if (BLOCKED_SCHEME.test(v)) {
        return ` ${attr}=${quote}#${quote}`;
      }
      return ` ${attr}=${quote}${value}${quote}`;
    },
  );
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = /\bsrc\s*=\s*(["'])([^"']*)\1/i.exec(tag);
    if (!srcMatch) {
      return "";
    }
    const src = srcMatch[2].trim();
    if (/^data:image\//i.test(src)) {
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
      i += 1;
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      html.push(
        `<pre><code${cls}>${escapeHtml(code.join("\n"))}</code></pre>`,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      closeLists();
      closeBq();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

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

export function csvToHtmlTable(text: string): string {
  const delim = text.includes("\t") && !text.includes(",") ? "\t" : ",";
  const rows = parseDelimited(text, delim);
  if (rows.length === 0) {
    return `<pre><code>${escapeHtml(text)}</code></pre>`;
  }
  const maxRows = Math.min(rows.length, 201);
  const maxCols = 40;
  const header = rows[0].slice(0, maxCols);
  const bodyRows = rows.slice(1, maxRows);

  const thead =
    "<thead><tr>" +
    header.map((c) => `<th>${escapeHtml(c)}</th>`).join("") +
    "</tr></thead>";
  const tbody =
    "<tbody>" +
    bodyRows
      .map(
        (r) =>
          "<tr>" +
          header
            .map((_, i) => `<td>${escapeHtml(r[i] ?? "")}</td>`)
            .join("") +
          "</tr>",
      )
      .join("") +
    "</tbody>";
  const note =
    rows.length > maxRows
      ? `<p class="muted">Showing ${maxRows - 1} of ${rows.length - 1} data rows.</p>`
      : "";
  return `${note}<table class="csv-table">${thead}${tbody}</table>`;
}

/** First document path that names a directory, used to hint preview kind. */
export function findPrimaryDocPath(text: string): string | null {
  const matches = text.match(new RegExp(DIR_DOC_PATH_SOURCE, "gi"));
  if (!matches || matches.length === 0) {
    return null;
  }
  return matches[0];
}

export function collectDocPaths(text: string): string[] {
  const matches = text.match(docPathRe()) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    if (seen.has(m)) {
      continue;
    }
    seen.add(m);
    out.push(m);
  }
  return out;
}

function prettyJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function parseDelimited(text: string, delim: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows: string[][] = [];
  for (const line of lines) {
    if (line === "" && rows.length === 0) {
      continue;
    }
    if (line === "" && rows.length > 0) {
      continue;
    }
    rows.push(splitDelimitedLine(line, delim));
  }
  return rows;
}

function splitDelimitedLine(line: string, delim: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delim && !inQuotes) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells;
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
  if (
    /^<[a-z][\w:-]*(\s|>|\/)/i.test(firstLine) &&
    /<\/[a-z][\w:-]*>/i.test(trimmed)
  ) {
    return true;
  }
  return false;
}

function looksLikeJson(trimmed: string): boolean {
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeMarkdown(trimmed: string): boolean {
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
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const href = url.trim();
    if (BLOCKED_SCHEME.test(href)) {
      return label;
    }
    return `<a href="${escapeAttr(href)}">${label}</a>`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  s = s.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");
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
    th, td { border-color: #444; }
    th { background: #2a2a2a; }
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
  table.csv-table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
    margin: 8px 0;
  }
  th, td {
    border: 1px solid #ccc;
    padding: 4px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f2f2f2; font-weight: 600; }
  .muted { opacity: 0.7; font-size: 12px; }
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
