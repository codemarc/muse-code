/**
 * Single entry point for "open this link" from the chat sidebar or the canvas.
 *
 * Everything local lands in the main editor area: the canvas preview when we
 * can render it, otherwise an editor tab. Only web URLs and formats with no
 * in-app renderer (spreadsheets, PDFs, Office docs) go out to the OS.
 */

import * as vscode from "vscode";
import type { CanvasFilePayload } from "./canvasPanel";
import { readCanvasFile } from "./canvasFile";
import { resolveToolLinkPath } from "./linkTarget";
import { museDataDir } from "./museDataPaths";
import { openToolLink } from "./openLink";
import { buildPreviewFromSource, CANVAS_FILE_EXT_RE } from "./previewContent";

/** Formats VS Code cannot show as text and the canvas cannot render. */
const EXTERNAL_ONLY_RE = /\.(?:xlsx?|pdf|docx?|pptx?)$/i;

export interface MainViewTarget {
  /** Workspace folder used to resolve relative paths (and for external opens). */
  workspaceFolder?: vscode.Uri;
  /** Show a file in the canvas panel. */
  showFile(file: CanvasFilePayload): void;
}

/** Roots the canvas may read: the workspace plus Muse's own data directory. */
export function canvasReadRoots(workspaceFolder?: vscode.Uri): string[] {
  return [workspaceFolder?.fsPath, museDataDir()].filter((p): p is string =>
    Boolean(p),
  );
}

export async function openLinkInMainView(
  href: string,
  target: MainViewTarget,
): Promise<void> {
  const trimmed = href.trim();
  if (!trimmed) {
    return;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const ok = await openToolLink(trimmed, target.workspaceFolder);
    if (!ok) {
      void vscode.window.showWarningMessage(`Could not open link: ${trimmed}`);
    }
    return;
  }

  const resolved = resolveToolLinkPath(trimmed, target.workspaceFolder?.fsPath);
  if (!resolved) {
    void vscode.window.showWarningMessage(`Could not resolve path: ${trimmed}`);
    return;
  }

  if (EXTERNAL_ONLY_RE.test(resolved)) {
    const ok = await openToolLink(resolved, target.workspaceFolder);
    if (!ok) {
      void vscode.window.showWarningMessage(`Could not open: ${resolved}`);
    }
    return;
  }

  // Images, source files, anything without a canvas renderer: editor tab.
  if (!CANVAS_FILE_EXT_RE.test(resolved)) {
    await openInEditorColumn(resolved);
    return;
  }

  const read = readCanvasFile(
    resolved,
    canvasReadRoots(target.workspaceFolder),
  );
  if (!read.ok) {
    if (read.reason === "missing" || read.reason === "empty-path") {
      void vscode.window.showWarningMessage(read.error);
      return;
    }
    await openInEditorColumn(read.filePath ?? resolved);
    return;
  }

  const built = buildPreviewFromSource(read.source, read.kind);
  target.showFile({
    path: read.filePath,
    title: read.filePath.split(/[/\\]/).pop() || read.filePath,
    kind: read.kind,
    source: read.source,
    previewHtml: built.previewHtml,
  });
}

/** Open a path as an editor tab in the main (non-sidebar) column. */
export async function openInEditorColumn(filePath: string): Promise<boolean> {
  try {
    await vscode.commands.executeCommand(
      "vscode.open",
      vscode.Uri.file(filePath),
      { viewColumn: vscode.ViewColumn.One, preview: false },
    );
    return true;
  } catch {
    void vscode.window.showWarningMessage(`Could not open file: ${filePath}`);
    return false;
  }
}
