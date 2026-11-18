import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { CanvasPanel } from "./canvasPanel";
import { ChatViewProvider } from "./chatViewProvider";
import { maybeWarnYolo } from "./safety";
import { SessionStore } from "./sessionStore";
import { WorkspaceFolderStore } from "./workspaceFolder";
import { TurnCheckpointStore } from "./turnCheckpoints";
import { normalizeExecutionMode } from "./executionMode";
import {
  NO_SECONDARY_CONTEXT_KEY,
  PRIMARY_VIEW_ID,
  SECONDARY_VIEW_ID,
  supportsSecondarySidebar,
} from "./viewLocation";

const OPEN_ON_ACTIVATE_KEY = "muse.openOnActivate";

export function activate(context: vscode.ExtensionContext): void {
  const onSecondary = supportsSecondarySidebar(vscode.version, vscode.env.appName);
  void vscode.commands.executeCommand("setContext", NO_SECONDARY_CONTEXT_KEY, !onSecondary);

  const sessions = new SessionStore(context);
  const folders = new WorkspaceFolderStore(context);
  const canvasPanel = new CanvasPanel(context.extensionUri, folders);
  const checkpoints = new TurnCheckpointStore(vscode.Uri.joinPath(context.globalStorageUri, "turn-checkpoints").fsPath);
  const provider = new ChatViewProvider(
    context.extensionUri,
    sessions,
    folders,
    canvasPanel,
    checkpoints,
    onSecondary ? SECONDARY_VIEW_ID : PRIMARY_VIEW_ID,
  );
  const chats = new Map<string, ChatViewProvider>();
  let active = provider;
  provider.onDidFocus = () => { active = provider; };
  const createChat = (id: string = randomUUID(), panel?: vscode.WebviewPanel, seed?: { sessionId: string; folder: vscode.Uri }): ChatViewProvider => {
    const chatFolders = new WorkspaceFolderStore(context, `muse.workspaceFolderUri.${id}`);
    const chatSessions = new SessionStore(context, id);
    if (seed) chatSessions.setSessionId(seed.sessionId);
    const canvas = new CanvasPanel(context.extensionUri, chatFolders);
    const chat = new ChatViewProvider(context.extensionUri, chatSessions, chatFolders, canvas,
      checkpoints, onSecondary ? SECONDARY_VIEW_ID : PRIMARY_VIEW_ID, {
        id, activate: () => { active = chat; }, closed: () => {
          chats.delete(id); if (active === chat) active = provider;
          chat.dispose(); canvas.dispose();
        },
      });
    chats.set(id, chat);
    chat.onDidFocus = () => { active = chat; };
    chat.onBranch = (sessionId, folder) => { createChat(undefined, undefined, { sessionId, folder }); };
    chat.onSessionMetadataChanged = () => allChats().forEach((item) => item.postSession());
    context.subscriptions.push(chat, canvas);
    if (panel) chat.restorePanel(panel);
    else if (seed) void chatFolders.setFolder(seed.folder).then(() => chat.openPanel(vscode.ViewColumn.Active)).catch((error) => {
      void vscode.window.showErrorMessage(`The branch was saved, but its editor could not open: ${String(error)}. Reopen it from session history.`);
    });
    else void chat.openPanel(vscode.ViewColumn.Active);
    return chat;
  };
  const allChats = () => [provider, ...chats.values()];
  provider.onBranch = (sessionId, folder) => { createChat(undefined, undefined, { sessionId, folder }); };
  provider.onSessionMetadataChanged = () => allChats().forEach((item) => item.postSession());
  context.subscriptions.push(
    vscode.commands.registerCommand("muse.newChat", () => { createChat(); }),
    vscode.commands.registerCommand("muse.renameSession", () => active.renameConversation()),
    vscode.commands.registerCommand("muse.forkSession", () => active.branchConversation()),
    vscode.window.registerWebviewPanelSerializer(ChatViewProvider.editorViewType, {
      async deserializeWebviewPanel(panel, state) {
        const saved = state as { chatId?: unknown } | undefined;
        const id = typeof saved?.chatId === "string" && /^[a-f0-9-]{36}$/.test(saved.chatId) ? saved.chatId : randomUUID();
        createChat(id, panel);
      },
    }),
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
      createChat();
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
    vscode.window.registerWebviewViewProvider(SECONDARY_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("muse.openChat", () => openPreferred()),
    vscode.commands.registerCommand("muse.open", () => openPreferred()),
    vscode.commands.registerCommand("muse.openPanel", () => { createChat(); }),
    vscode.commands.registerCommand("muse.openEditor", () => { createChat(); }),
    vscode.commands.registerCommand("muse.openSecondarySidebar", () => provider.reveal()),
    vscode.commands.registerCommand("muse.toggleChat", () => provider.toggle()),
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
      active.sendSelection(),
    ),
    vscode.commands.registerCommand("muse.newSession", () => { createChat(); }),
    vscode.commands.registerCommand("muse.stop", () => active.stop()),
    vscode.commands.registerCommand("muse.openInteractiveTerminal", () =>
      active.openInteractiveTerminal(),
    ),
    vscode.commands.registerCommand("muse.openMuseAi", () =>
      active.openMuseAi(),
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
      active.selectWorkspaceFolder(),
    ),
    vscode.commands.registerCommand("muse.pickSession", () =>
      active.pickSession(),
    ),
    vscode.commands.registerCommand("muse.cleanupSessions", () =>
      active.cleanupSessions(),
    ),
    vscode.commands.registerCommand("muse.openInCanvas", () =>
      canvasPanel.reveal(),
    ),
    vscode.commands.registerCommand("muse.expandAll", () =>
      active.expandAll(),
    ),
    vscode.commands.registerCommand("muse.collapseAll", () =>
      active.collapseAll(),
    ),
    vscode.commands.registerCommand("muse.exportTranscript", () =>
      active.exportTranscript(),
    ),
    vscode.commands.registerCommand("muse.copyRequestId", () =>
      active.copyRequestId(),
    ),
    vscode.commands.registerCommand("muse.openSettings", () =>
      provider.openSettings(),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("muse.toolOutputFormat") ||
        e.affectsConfiguration("muse.toolDisplay") ||
        e.affectsConfiguration("muse.chatFormat")
        || e.affectsConfiguration("muse.executionMode")
        || e.affectsConfiguration("muse.model")
        || e.affectsConfiguration("muse.reasoningEffort")
      ) {
        allChats().forEach((chat) => chat.postConfig());
        canvasPanel.postConfig();
      }
      if (e.affectsConfiguration("muse.useEchoProvider")) {
        // Muse refuses to resume a session with a different provider.
        allChats().forEach((chat) => chat.newSession("Provider changed, started a new session"));
      }
      if (e.affectsConfiguration("muse")) {
        allChats().forEach((chat) => { void chat.refreshSetup(); });
        void maybeWarnYolo(context);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      allChats().forEach((chat) => { void chat.refreshSetup(); });
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
