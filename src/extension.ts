import * as vscode from "vscode";
import { CanvasPanel } from "./canvasPanel";
import { ChatViewProvider } from "./chatViewProvider";
import { maybeWarnYolo } from "./safety";
import { SessionStore } from "./sessionStore";
import { WorkspaceFolderStore } from "./workspaceFolder";
import { normalizeExecutionMode } from "./executionMode";

const OPEN_ON_ACTIVATE_KEY = "muse.openOnActivate";

export function activate(context: vscode.ExtensionContext): void {
  const [major, minor] = vscode.version.split(".").map((value) => Number(value));
  void vscode.commands.executeCommand(
    "setContext",
    "muse:doesNotSupportSecondarySidebar",
    major === 1 && minor < 97,
  );

  const sessions = new SessionStore(context);
  const folders = new WorkspaceFolderStore(context);
  const canvasPanel = new CanvasPanel(context.extensionUri, folders);
  const provider = new ChatViewProvider(
    context.extensionUri,
    sessions,
    folders,
    canvasPanel,
  );

  const openPreferred = async (): Promise<void> => {
    const cfg = vscode.workspace.getConfiguration("muse");
    if (
      cfg.get<boolean>("useTerminal", false) ||
      normalizeExecutionMode(cfg.get<string>("executionMode", "headless")) ===
        "interactive"
    ) {
      await provider.openInteractiveTerminal();
      return;
    }
    const location = cfg.get<string>("preferredLocation", "secondarySidebar");
    if (location === "terminal") {
      await provider.openInteractiveTerminal();
      return;
    }
    if (location === "panel") {
      await provider.openPanel();
      return;
    }
    provider.reveal();
  };

  context.subscriptions.push(
    provider,
    canvasPanel,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider("muse.chatViewActivity", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("muse.openChat", () => openPreferred()),
    vscode.commands.registerCommand("muse.openPanel", () => provider.openPanel()),
    vscode.commands.registerCommand("muse.openSecondarySidebar", () => provider.reveal()),
    vscode.commands.registerCommand("muse.openNewWindow", async () => {
      const folder = folders.getFolder() ?? vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showErrorMessage("Open a folder before opening Muse in a new window.");
        return;
      }
      await context.globalState.update(OPEN_ON_ACTIVATE_KEY, folder.uri.fsPath);
      await vscode.commands.executeCommand("vscode.openFolder", folder.uri, { forceNewWindow: true });
    }),
    vscode.commands.registerCommand("muse.sendSelection", () =>
      provider.sendSelection(),
    ),
    vscode.commands.registerCommand("muse.newSession", () => provider.newSession()),
    vscode.commands.registerCommand("muse.stop", () => provider.stop()),
    vscode.commands.registerCommand("muse.openInteractiveTerminal", () =>
      provider.openInteractiveTerminal(),
    ),
    vscode.commands.registerCommand("muse.openMuseAi", () =>
      provider.openMuseAi(),
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
    vscode.commands.registerCommand("muse.expandAll", () =>
      provider.expandAll(),
    ),
    vscode.commands.registerCommand("muse.collapseAll", () =>
      provider.collapseAll(),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("muse.toolOutputFormat") ||
        e.affectsConfiguration("muse.toolDisplay") ||
        e.affectsConfiguration("muse.chatFormat")
        || e.affectsConfiguration("muse.executionMode")
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

  const pending = context.globalState.get<string>(OPEN_ON_ACTIVATE_KEY);
  if (pending && vscode.workspace.workspaceFolders?.some((f) => f.uri.fsPath === pending)) {
    void context.globalState.update(OPEN_ON_ACTIVATE_KEY, undefined);
    void openPreferred();
  }

  void maybeWarnYolo(context);
}

export function deactivate(): void {}
