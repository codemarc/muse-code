import * as vscode from "vscode";
import { CanvasPanel } from "./canvasPanel";
import { ChatViewProvider } from "./chatViewProvider";
import { maybeWarnYolo } from "./safety";
import { SessionStore } from "./sessionStore";
import { WorkspaceFolderStore } from "./workspaceFolder";

export function activate(context: vscode.ExtensionContext): void {
  const sessions = new SessionStore(context);
  const folders = new WorkspaceFolderStore(context);
  const canvasPanel = new CanvasPanel(context.extensionUri, folders);
  const provider = new ChatViewProvider(
    context.extensionUri,
    sessions,
    folders,
    canvasPanel,
  );

  context.subscriptions.push(
    provider,
    canvasPanel,
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
    vscode.commands.registerCommand("muse.openWebsite", () =>
      vscode.env.openExternal(
        vscode.Uri.parse("https://developer.meta.com/ai/products/muse-code/"),
      ),
    ),
    vscode.commands.registerCommand("muse.openBilling", () =>
      vscode.env.openExternal(
        vscode.Uri.parse("https://dev.meta.ai/billing/"),
      ),
    ),
    vscode.commands.registerCommand("muse.checkInstallation", () =>
      provider.checkInstallation(),
    ),
    vscode.commands.registerCommand("muse.selectWorkspaceFolder", () =>
      provider.selectWorkspaceFolder(),
    ),
    vscode.commands.registerCommand("muse.pickSession", () =>
      provider.pickSession(),
    ),
    vscode.commands.registerCommand("muse.cleanupSessions", () =>
      provider.cleanupSessions(),
    ),
    vscode.commands.registerCommand("muse.openInCanvas", () =>
      canvasPanel.reveal(),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("muse.toolOutputFormat") ||
        e.affectsConfiguration("muse.chatFormat")
      ) {
        provider.postConfig();
        canvasPanel.postConfig();
      }
      if (e.affectsConfiguration("muse")) {
        void provider.refreshSetup();
        void maybeWarnYolo(context);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void provider.refreshSetup();
    }),
  );

  void maybeWarnYolo(context);
}

export function deactivate(): void {}
