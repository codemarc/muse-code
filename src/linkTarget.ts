import { homedir } from "node:os";
import * as path from "node:path";

const BLOCKED_SCHEME = /^(javascript|data|vbscript):/i;

/** Sentence and markup characters that are never part of a link. */
const TRAILING_PUNCT_RE = /[.,;:!?'"*`>]+$/;

const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function countChar(text: string, ch: string): number {
  let n = 0;
  for (const c of text) {
    if (c === ch) {
      n += 1;
    }
  }
  return n;
}

/**
 * Drop punctuation that trails a link in prose, e.g. the `)` in
 * `(https://example.com/)` or the period in `see /tmp/a.md.`.
 * A closing bracket is kept when the link opens one itself, so
 * `…/wiki/Foo_(bar)` survives intact.
 */
export function trimLinkEnd(href: string): string {
  let out = href.trim();
  for (let guard = 0; guard < 8; guard += 1) {
    const stripped = out.replace(TRAILING_PUNCT_RE, "");
    if (stripped !== out) {
      out = stripped;
      continue;
    }
    const last = out.slice(-1);
    const opener = CLOSERS[last];
    if (opener && countChar(out, last) > countChar(out, opener)) {
      out = out.slice(0, -1);
      continue;
    }
    break;
  }
  return out;
}

export type LinkTarget =
  | { kind: "http"; href: string }
  | { kind: "file"; filePath: string }
  | { kind: "relative"; relativePath: string };

/** True when the link should open in the system browser (not the editor). */
export function shouldOpenInBrowser(href: string): boolean {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return true;
  }
  const withoutScheme = trimmed.replace(/^file:\/\//i, "");
  const pathOnly = withoutScheme.split(/[?#]/)[0] ?? withoutScheme;
  return /\.html?$/i.test(pathOnly);
}

/** Classify and normalize a link from tool output (pure, testable). */
export function classifyToolLink(
  href: string,
  workspacePath?: string,
): LinkTarget | null {
  const trimmed = trimLinkEnd(href);
  if (!trimmed || BLOCKED_SCHEME.test(trimmed)) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: "http", href: trimmed };
  }

  if (trimmed.startsWith("file://")) {
    try {
      const decoded = decodeURIComponent(trimmed.replace(/^file:\/\//i, ""));
      return { kind: "file", filePath: decoded };
    } catch {
      return null;
    }
  }

  if (trimmed === "~" || trimmed.startsWith("~/")) {
    return { kind: "file", filePath: path.join(homedir(), trimmed.slice(1)) };
  }

  if (path.isAbsolute(trimmed)) {
    return { kind: "file", filePath: trimmed };
  }

  if (workspacePath) {
    return { kind: "relative", relativePath: trimmed };
  }

  return null;
}

export function resolveToolLinkPath(
  href: string,
  workspacePath?: string,
): string | null {
  const target = classifyToolLink(href, workspacePath);
  if (!target) {
    return null;
  }
  if (target.kind === "http") {
    return target.href;
  }
  if (target.kind === "relative") {
    return path.join(workspacePath!, target.relativePath);
  }
  return target.filePath;
}
