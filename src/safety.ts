import * as vscode from "vscode";
import { readMuseSettings } from "./museCli";

const YOLO_WARN_KEY = "muse.yoloWarned";

/**
 * Ensure headless sidebar runs can proceed.
 * Muse exec cannot answer interactive approvals; ask once to enable
 * disable-approval (sandbox stays on) or send the user to the TUI.
 */
export async function ensureHeadlessConsent(): Promise<boolean> {
  const settings = readMuseSettings();
  if (settings.yolo || settings.disableApproval) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    "Sidebar chat runs Muse headless, so it cannot answer interactive approval prompts. Enable disable-approval for this machine? The OS sandbox stays on. Prefer Open Interactive Terminal when you want staged approvals.",
    { modal: true },
    "Enable disable-approval",
    "Open Interactive Terminal",
    "Cancel",
  );

  if (choice === "Enable disable-approval") {
    await vscode.workspace
      .getConfiguration("muse")
      .update("disableApproval", true, vscode.ConfigurationTarget.Global);
    return true;
  }
  if (choice === "Open Interactive Terminal") {
    await vscode.commands.executeCommand("muse.openInteractiveTerminal");
    return false;
  }
  return false;
}

export async function maybeWarnYolo(
  context: vscode.ExtensionContext,
): Promise<void> {
  const settings = readMuseSettings();
  if (!settings.yolo) {
    await context.globalState.update(YOLO_WARN_KEY, false);
    return;
  }
  if (context.globalState.get<boolean>(YOLO_WARN_KEY)) {
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    "Muse CLI Chat: muse.yolo is enabled. This disables the OS sandbox and approval prompts. Only use it in workspaces you fully trust.",
    "I understand",
    "Disable yolo",
  );
  if (choice === "Disable yolo") {
    await vscode.workspace
      .getConfiguration("muse")
      .update("yolo", false, vscode.ConfigurationTarget.Global);
    await context.globalState.update(YOLO_WARN_KEY, false);
    return;
  }
  if (choice === "I understand") {
    await context.globalState.update(YOLO_WARN_KEY, true);
  }
}
