import * as path from "node:path";

const BLOCKED_SCHEME = /^(javascript|data|vbscript):/i;

export type LinkTarget =
  | { kind: "http"; href: string }
  | { kind: "file"; filePath: string }
  | { kind: "relative"; relativePath: string };

/** Classify and normalize a link from tool output (pure, testable). */
export function classifyToolLink(
  href: string,
  workspacePath?: string,
): LinkTarget | null {
  const trimmed = href.trim();
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
