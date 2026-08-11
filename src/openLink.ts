import * as vscode from "vscode";
import { classifyToolLink, resolveToolLinkPath } from "./linkTarget";

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

export async function openToolLink(
  href: string,
  workspaceFolder?: vscode.Uri,
): Promise<boolean> {
  const uri = resolveToolLinkUri(href, workspaceFolder);
  if (!uri) {
    return false;
  }

  if (/^https?:\/\//i.test(uri.toString(true))) {
    return vscode.env.openExternal(uri);
  }

  try {
    if (await vscode.env.openExternal(uri)) {
      return true;
    }
  } catch {
    // Fall through to editor open.
  }

  try {
    await vscode.commands.executeCommand("vscode.open", uri);
    return true;
  } catch {
    return false;
  }
}
