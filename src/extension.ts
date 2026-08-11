import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";
import { maybeWarnYolo } from "./safety";
import { SessionStore } from "./sessionStore";
import { WorkspaceFolderStore } from "./workspaceFolder";

export function activate(context: vscode.ExtensionContext): void {
  const sessions = new SessionStore(context);
  const folders = new WorkspaceFolderStore(context);
  const provider = new ChatViewProvider(context.extensionUri, sessions, folders);

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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("muse.toolOutputFormat")) {
        provider.postConfig();
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
