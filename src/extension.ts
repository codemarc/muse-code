import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";
import { readMuseSettings } from "./museCli";
import { SessionStore } from "./sessionStore";

const YOLO_WARN_KEY = "muse.yoloWarned";

export function activate(context: vscode.ExtensionContext): void {
  const sessions = new SessionStore(context);
  const provider = new ChatViewProvider(context.extensionUri, sessions);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("muse.openChat", () => provider.reveal()),
    vscode.commands.registerCommand("muse.sendSelection", () =>
      provider.sendSelection(),
    ),
    vscode.commands.registerCommand("muse.newSession", () => provider.newSession()),
    vscode.commands.registerCommand("muse.stop", () => provider.stop()),
    vscode.commands.registerCommand("muse.openInteractiveTerminal", () =>
      provider.openInteractiveTerminal(),
    ),
    vscode.commands.registerCommand("muse.checkInstallation", () =>
      provider.checkInstallation(),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("muse")) {
        void provider.refreshSetup();
        void maybeWarnYolo(context);
      }
    }),
  );

  void maybeWarnYolo(context);
}

async function maybeWarnYolo(context: vscode.ExtensionContext): Promise<void> {
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

export function deactivate(): void {}
