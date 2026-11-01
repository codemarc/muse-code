/**
 * Cursor-style context attachments: resolve composer chips into prompt blocks.
 *
 * The webview sends lightweight descriptors (file path, problems, terminal,
 * open editors). The extension host expands them into fenced blocks appended
 * to the user prompt so `muse exec` sees file contents inline instead of a
 * bare path it must re-read (fewer round trips, no missed reads).
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isUnderWorkspace } from "./canvasFile";

export type AttachmentKind = "file" | "problems" | "terminal" | "editors";

export interface AttachmentRequest {
  kind: AttachmentKind;
  /** Workspace-relative path for `file` attachments. */
  path?: string;
}

export interface SimplifiedDiagnostic {
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based character offset. */
  character: number;
  severity: string;
  message: string;
  source?: string;
}

export interface TerminalEntry {
  command: string;
  output: string;
  exitCode?: number | null;
}

export interface EditorSnapshot {
  path: string;
  content: string;
  truncated?: boolean;
}

export const MAX_FILE_CHARS = 32_000;
export const MAX_EDITORS = 8;
export const MAX_EDITOR_CHARS = 16_000;
export const MAX_DIAGNOSTICS = 100;
export const MAX_TERMINAL_CHARS = 8_000;
export const MAX_TERMINAL_ENTRIES = 5;

const ATTACHED_OPEN = "<attached-context>";
const ATTACHED_CLOSE = "</attached-context>";

export function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxChars), truncated: true };
}

/** Strip ANSI escape sequences from terminal output. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "").replace(/\r/g, "");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function formatFileBlock(
  path: string,
  content: string,
  opts?: { truncated?: boolean },
): string {
  const note = opts?.truncated ? " truncated=\"true\"" : "";
  return `<file path="${escapeAttr(path)}"${note}>\n${content}\n</file>`;
}

export function formatDiagnosticsBlock(items: SimplifiedDiagnostic[]): string {
  if (items.length === 0) {
    return "<problems>\nNo problems reported in this workspace.\n</problems>";
  }
  const lines = items.slice(0, MAX_DIAGNOSTICS).map((d) => {
    const loc = `${d.path}:${d.line}:${d.character}`;
    const src = d.source ? ` [${d.source}]` : "";
    const firstLine = d.message.split("\n")[0] ?? d.message;
    return `${loc} ${d.severity}${src}: ${firstLine}`;
  });
  const extra =
    items.length > MAX_DIAGNOSTICS
      ? `\n… and ${items.length - MAX_DIAGNOSTICS} more`
      : "";
  return `<problems>\n${lines.join("\n")}${extra}\n</problems>`;
}

export function formatTerminalBlock(entries: TerminalEntry[]): string {
  if (entries.length === 0) {
    return (
      "<terminal>\nNo terminal output captured yet. " +
      "Run a command in the integrated terminal (with shell integration enabled) " +
      "and attach again.\n</terminal>"
    );
  }
  const parts = entries.slice(-MAX_TERMINAL_ENTRIES).map((e) => {
    const clean = truncateText(stripAnsi(e.output), MAX_TERMINAL_CHARS);
    const exit = e.exitCode === undefined || e.exitCode === null ? "" : ` (exit ${e.exitCode})`;
    const cmd = e.command || "(unknown command)";
    return `$ ${cmd}${exit}\n${clean.text}${clean.truncated ? "\n… (truncated)" : ""}`;
  });
  return `<terminal>\n${parts.join("\n\n")}\n</terminal>`;
}

export function formatEditorsBlock(files: EditorSnapshot[]): string {
  if (files.length === 0) {
    return "<editors>\nNo open editors.\n</editors>";
  }
  const parts = files.slice(0, MAX_EDITORS).map((f) => {
    const note = f.truncated ? " truncated=\"true\"" : "";
    return `<editor path="${escapeAttr(f.path)}"${note}>\n${f.content}\n</editor>`;
  });
  const extra =
    files.length > MAX_EDITORS ? `\n… and ${files.length - MAX_EDITORS} more open editors` : "";
  return `<editors>\n${parts.join("\n")}${extra}\n</editors>`;
}

/** Append context blocks to the user prompt. No blocks → prompt unchanged. */
export function buildAttachedPrompt(prompt: string, blocks: string[]): string {
  const useful = blocks.filter((b) => b.trim().length > 0);
  if (useful.length === 0) {
    return prompt;
  }
  return `${prompt}\n\n${ATTACHED_OPEN}\n${useful.join("\n")}\n${ATTACHED_CLOSE}`;
}

export interface StrippedPrompt {
  display: string;
  attached: string[];
}

/**
 * Split an expanded prompt back into its display text plus attachment labels.
 * Used so the sidebar shows the compact prompt with chips instead of the full
 * inline contents that were sent to the model.
 */
export function stripAttachedContext(text: string): StrippedPrompt {
  const open = text.lastIndexOf(ATTACHED_OPEN);
  const close = text.lastIndexOf(ATTACHED_CLOSE);
  if (open === -1 || close === -1 || close < open) {
    return { display: text, attached: [] };
  }
  const inner = text.slice(open + ATTACHED_OPEN.length, close);
  const display = (text.slice(0, open) + text.slice(close + ATTACHED_CLOSE.length)).trimEnd();
  const attached: string[] = [];
  const fileRe = /<file path="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(inner)) !== null) {
    attached.push(m[1] || "file");
  }
  const editorRe = /<editor path="([^"]*)"/g;
  const editorPaths: string[] = [];
  while ((m = editorRe.exec(inner)) !== null) {
    editorPaths.push(m[1] || "editor");
  }
  if (editorPaths.length > 0) {
    attached.push(
      editorPaths.length <= 3 ? `Open editors (${editorPaths.length})` : "Open editors",
    );
  }
  if (inner.includes("<problems>")) {
    attached.push("Problems");
  }
  if (inner.includes("<terminal>")) {
    attached.push("Terminal");
  }
  if (inner.includes("<editors>") && editorPaths.length === 0) {
    attached.push("Open editors");
  }
  return { display, attached };
}

/** Short chip labels for attachment descriptors (composer + history). */
export function summarizeAttachments(reqs: AttachmentRequest[]): string[] {
  return reqs.map((r) => {
    switch (r.kind) {
      case "file":
        return r.path || "file";
      case "problems":
        return "Problems";
      case "terminal":
        return "Terminal";
      case "editors":
        return "Open editors";
    }
  });
}

export type ReadAttachmentResult =
  | { ok: true; content: string; truncated: boolean; resolved: string }
  | { ok: false; error: string };

/**
 * Read a workspace-relative file for attachment. Root-jailed and capped so a
 * huge or outside-workspace pick degrades to a warning line instead of a
 * failed send.
 */
export function readAttachmentFile(
  workspaceRoot: string,
  relPath: string,
  maxChars = MAX_FILE_CHARS,
): ReadAttachmentResult {
  const rel = (relPath || "").replace(/\\/g, "/").trim();
  if (!rel) {
    return { ok: false, error: "Empty file path." };
  }
  const abs = resolve(workspaceRoot, rel);
  if (!isUnderWorkspace(abs, workspaceRoot)) {
    return { ok: false, error: `File is outside the workspace: ${rel}` };
  }
  if (!existsSync(abs)) {
    return { ok: false, error: `File not found: ${rel}` };
  }
  try {
    if (!lstatSync(abs).isFile()) {
      return { ok: false, error: `Not a regular file: ${rel}` };
    }
  } catch {
    return { ok: false, error: `Cannot read file: ${rel}` };
  }
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    return { ok: false, error: `Cannot read file: ${rel}` };
  }
  if (raw.includes("\0")) {
    return { ok: false, error: `File looks binary, skipped: ${rel}` };
  }
  const { text, truncated } = truncateText(raw, maxChars);
  return { ok: true, content: text, truncated, resolved: abs };
}
