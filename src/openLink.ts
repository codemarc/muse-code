import { spawn } from "node:child_process";
import * as vscode from "vscode";
import {
  classifyToolLink,
  resolveToolLinkPath,
  shouldOpenInBrowser,
} from "./linkTarget";

/** Resolve a link href from tool output to a VS Code URI. */
export function resolveToolLinkUri(
  href: string,
  workspaceFolder?: vscode.Uri,
): vscode.Uri | null {
  const workspacePath = workspaceFolder?.fsPath;
  const target = classifyToolLink(href, workspacePath);
  if (!target) {
    return null;
  }

  if (target.kind === "http") {
    return vscode.Uri.parse(target.href);
  }

  const filePath = resolveToolLinkPath(href, workspacePath);
  if (!filePath) {
    return null;
  }
  return vscode.Uri.file(filePath);
}

/**
 * Open a tool-output link.
 * - http(s) → system browser via openExternal
 * - local *.html / *.htm → OS default app (browser) via `open` / `xdg-open`
 * - other local paths → reveal in Finder/Files (`revealFileInOS`)
 */
export async function openToolLink(
  href: string,
  workspaceFolder?: vscode.Uri,
): Promise<boolean> {
  const target = classifyToolLink(href, workspaceFolder?.fsPath);
  if (!target) {
    return false;
  }

  if (target.kind === "http") {
    try {
      return await vscode.env.openExternal(vscode.Uri.parse(target.href));
    } catch {
      return false;
    }
  }

  const filePath = resolveToolLinkPath(href, workspaceFolder?.fsPath);
  if (!filePath) {
    return false;
  }
  const fileUri = vscode.Uri.file(filePath);

  // HTML reports: open with the OS so the default browser gets file://…
  // vscode.env.openExternal(file) often fails in Cursor/VS Code with
  // "No application found to open URL".
  if (shouldOpenInBrowser(filePath) || shouldOpenInBrowser(href)) {
    if (await openPathWithOs(filePath)) {
      return true;
    }
    try {
      const fileUrl = vscode.Uri.parse(fileUri.toString(true));
      return await vscode.env.openExternal(fileUrl);
    } catch {
      return false;
    }
  }

  // Non-HTML local files: show in Finder / file manager.
  try {
    await vscode.commands.executeCommand("revealFileInOS", fileUri);
    return true;
  } catch {
    // fall through
  }

  if (await revealPathWithOs(filePath)) {
    return true;
  }

  try {
    await vscode.commands.executeCommand("vscode.open", fileUri);
    return true;
  } catch {
    return false;
  }
}

function openPathWithOs(filePath: string): Promise<boolean> {
  if (process.platform === "darwin") {
    return runDetached("open", [filePath]);
  }
  if (process.platform === "linux") {
    return runDetached("xdg-open", [filePath]);
  }
  return Promise.resolve(false);
}

function revealPathWithOs(filePath: string): Promise<boolean> {
  if (process.platform === "darwin") {
    return runDetached("open", ["-R", filePath]);
  }
  if (process.platform === "linux") {
    // Best-effort: open containing directory.
    return runDetached("xdg-open", [filePath.replace(/\/[^/]+$/, "") || "/"]);
  }
  return Promise.resolve(false);
}

function runDetached(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => resolve(false));
      child.unref();
      // Assume success if spawn did not emit error synchronously.
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}
