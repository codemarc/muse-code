import * as vscode from "vscode";
import type { CanvasPanel, CanvasPayload } from "./canvasPanel";
import { buildFileChips, type FileChip } from "./fileChips";
import { probeMuseAuth } from "./museAuth";
import { openLinkInMainView } from "./openInMainView";
import {
  checkMuseInstallation,
  resolveMuseBinary,
  readMuseSettings,
  startMuseExec,
  type MuseRunHandle,
} from "./museCli";
import { loadSessionTranscript } from "./museExport";
import type { MuseUiEvent } from "./museJsonl";
import {
  deleteMuseSessions,
  formatSessionPickLabel,
  listMuseSessionsForWorkspace,
} from "./museSessions";
import { isSupportedPlatform, unsupportedPlatformMessage } from "./platform";
import { buildChatMarkdownHtml } from "./previewContent";
import { ensureHeadlessConsent } from "./safety";
import type { SessionStore } from "./sessionStore";
import { formatToolResult } from "./toolResultFormat";
import { appendLiveUiEvent, type TranscriptItem } from "./transcript";
import { inspectWorkspaceRoot } from "./workspace";
import type { WorkspaceFolderStore } from "./workspaceFolder";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "muse.chatView";

  private view?: vscode.WebviewView;
  private run?: MuseRunHandle;
  private readonly status: vscode.StatusBarItem;
  private liveTranscript: TranscriptItem[] = [];
  private hydrateEpoch = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionStore,
    private readonly folders: WorkspaceFolderStore,
    private readonly canvasPanel: CanvasPanel,
  ) {
    this.status = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.status.command = "muse.openChat";
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
        case "ready":
          this.post({
            type: "session",
            sessionId: this.sessions.getSessionId(),
          });
          this.postFolder();
          this.postConfig();
          await this.refreshSetup();
          await this.hydrateTranscript({ paintCacheFirst: true });
          break;
        case "submit":
          await this.submitPrompt(String(msg.prompt ?? ""));
          break;
        case "stop":
          this.stop();
          break;
        case "newSession":
          this.newSession();
          break;
        case "pickSession":
          await this.pickSession();
          break;
        case "openTerminal":
          await vscode.commands.executeCommand("muse.openInteractiveTerminal");
          break;
        case "recheck":
          await this.refreshSetup();
          break;
        case "selectFolder":
          await this.selectWorkspaceFolder();
          break;
        case "openDocs":
          await vscode.env.openExternal(
            vscode.Uri.parse("https://dev.meta.ai/docs/muse-code"),
          );
          break;
        case "openLink":
          await this.handleOpenLink(String(msg.href ?? ""));
          break;
        case "openCanvas":
          this.openCanvas(msg.payload as CanvasPayload | undefined);
          break;
        case "openCanvasFile":
          await this.openCanvasFile(String(msg.href ?? ""));
          break;
      }
    });
  }

  private openCanvas(payload: CanvasPayload | undefined): void {
    if (!payload) {
      return;
    }
    const hasContent = Boolean(payload.resultRaw || payload.resultView);
    if (!hasContent) {
      return;
    }
    this.canvasPanel.show(payload);
  }

  /** Chip clicks and chat links both land in the main editor area. */
  private async openCanvasFile(href: string): Promise<void> {
    await openLinkInMainView(href, {
      workspaceFolder: this.folders.getFolder()?.uri,
      showFile: (file) => this.canvasPanel.showFile(file),
    });
  }

  postConfig(): void {
    const cfg = vscode.workspace.getConfiguration("muse");
    this.post({
      type: "config",
      toolOutputFormat: cfg.get<"readable" | "json">(
        "toolOutputFormat",
        "readable",
      ),
      toolDisplay: cfg.get<"compact" | "balanced" | "detailed">(
        "toolDisplay",
        "compact",
      ),
      chatFormat: cfg.get<"markdown" | "plain">("chatFormat", "markdown"),
    });
  }

  reveal(): void {
    void vscode.commands.executeCommand("muse.chatView.focus");
  }

  newSession(): void {
    this.stop();
    this.hydrateEpoch += 1;
    const id = this.sessions.newSession();
    this.liveTranscript = [];
    this.post({ type: "session", sessionId: id });
    this.post({ type: "history", items: [], source: "new" });
    this.post({
      type: "status",
      text: `New session ${id.slice(0, 8)}…`,
    });
  }

  stop(): void {
    if (this.run) {
      this.run.stop();
      this.run = undefined;
      this.setRunning(false);
      this.post({ type: "status", text: "Stopped" });
      this.post({ type: "running", running: false });
    }
  }

  async refreshSetup(): Promise<void> {
    this.postFolder();
    const setup = await this.probeSetup();
    this.post({ type: "setup", ...setup });
  }

  async selectWorkspaceFolder(): Promise<void> {
    const choice = await this.folders.resolveFolder({ forcePick: true });
    if (!choice) {
      return;
    }
    // Muse sessions are workspace-scoped; switching roots starts a new session.
    this.newSession();
    this.postFolder();
    await this.refreshSetup();
    void vscode.window.showInformationMessage(
      `Muse CLI Chat will use folder: ${choice.name}`,
    );
  }

  async pickSession(): Promise<void> {
    if (this.run) {
      void vscode.window.showWarningMessage("Stop the current Muse run first.");
      return;
    }
    const folder = await this.folders.resolveFolder();
    if (!folder) {
      void vscode.window.showErrorMessage("Open a folder to browse Muse sessions.");
      return;
    }
    const root = inspectWorkspaceRoot(folder.fsPath);
    if (!root.ok) {
      void vscode.window.showErrorMessage(root.error);
      return;
    }

    const sessions = listMuseSessionsForWorkspace(root.path, { limit: 40 });
    const current = this.sessions.getSessionId();
    const items: (vscode.QuickPickItem & {
      sessionId?: string;
      isNew?: boolean;
      isCleanup?: boolean;
    })[] = [
      {
        label: "$(add) New session",
        description: "Start a fresh --session-id",
        isNew: true,
      },
      {
        label: "$(trash) Clean up sessions…",
        description: "Delete old Muse sessions for this folder",
        isCleanup: true,
      },
      ...sessions.map((s) => ({
        label: formatSessionPickLabel(s),
        description: s.sessionId === current ? "current" : s.sessionId.slice(0, 8),
        detail: s.firstUserPrompt ?? undefined,
        sessionId: s.sessionId,
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: "Muse CLI Chat: Resume session",
      placeHolder: "Pick a Muse session to continue (same --session-id)",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) {
      return;
    }
    if (picked.isCleanup) {
      await this.cleanupSessions();
      return;
    }
    if (picked.isNew) {
      this.newSession();
      return;
    }
    if (!picked.sessionId) {
      return;
    }
    await this.resumeSession(picked.sessionId);
  }

  async cleanupSessions(): Promise<void> {
    if (this.run) {
      void vscode.window.showWarningMessage("Stop the current Muse run first.");
      return;
    }
    const folder = await this.folders.resolveFolder();
    if (!folder) {
      void vscode.window.showErrorMessage(
        "Open a folder to clean up Muse sessions.",
      );
      return;
    }
    const root = inspectWorkspaceRoot(folder.fsPath);
    if (!root.ok) {
      void vscode.window.showErrorMessage(root.error);
      return;
    }

    const sessions = listMuseSessionsForWorkspace(root.path, { limit: 100 });
    if (sessions.length === 0) {
      void vscode.window.showInformationMessage(
        "No Muse sessions found for this folder.",
      );
      return;
    }

    const current = this.sessions.getSessionId();
    const picked = await vscode.window.showQuickPick(
      sessions.map((s) => ({
        label: formatSessionPickLabel(s),
        description:
          s.sessionId === current ? "current" : s.sessionId.slice(0, 8),
        detail: s.firstUserPrompt ?? undefined,
        sessionId: s.sessionId,
      })),
      {
        title: "Muse CLI Chat: Clean up sessions",
        placeHolder: "Select sessions to delete (multi-select)",
        canPickMany: true,
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (!picked || picked.length === 0) {
      return;
    }

    const count = picked.length;
    const confirm = await vscode.window.showWarningMessage(
      `Delete ${count} Muse session${count === 1 ? "" : "s"} for this folder from the local index and remove their log files? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (confirm !== "Delete") {
      return;
    }

    const ids = picked.map((p) => p.sessionId);
    const result = deleteMuseSessions({
      workspacePath: root.path,
      sessionIds: ids,
    });

    if (result.deletedIds.length === 0) {
      const detail = result.errors[0] ?? "No sessions were deleted.";
      void vscode.window.showErrorMessage(
        `Could not clean up sessions. ${detail} If Muse’s interactive terminal is open, close it and try again.`,
      );
      return;
    }

    const deletedCurrent = result.deletedIds.includes(current);
    if (deletedCurrent) {
      this.newSession();
    }

    const msg =
      result.errors.length > 0
        ? `Deleted ${result.deletedIds.length} session(s); some log files could not be removed.`
        : `Deleted ${result.deletedIds.length} Muse session(s).`;
    void vscode.window.showInformationMessage(msg);
    if (result.errors.length > 0) {
      console.warn("muse.cleanupSessions", result.errors);
    }
  }

  async resumeSession(sessionId: string): Promise<void> {
    this.stop();
    this.hydrateEpoch += 1;
    this.sessions.setSessionId(sessionId);
    this.liveTranscript = this.sessions.getCachedTranscript(sessionId);
    this.post({ type: "session", sessionId });
    this.post({
      type: "history",
      items: this.enrichItemsForWebview(this.liveTranscript),
      source: "cache",
    });
    await this.hydrateTranscript({ paintCacheFirst: false });
    void vscode.window.showInformationMessage(
      `Resumed Muse session ${sessionId.slice(0, 8)}…`,
    );
  }

  async submitPrompt(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }
    if (this.run) {
      void vscode.window.showWarningMessage("Muse is already running. Stop it first.");
      return;
    }

    const folder = await this.folders.resolveFolder();
    if (!folder) {
      void vscode.window.showErrorMessage(
        "Open a folder (or pick one in a multi-root workspace) to run Muse Code.",
      );
      await this.refreshSetup();
      return;
    }

    const root = inspectWorkspaceRoot(folder.fsPath);
    if (!root.ok) {
      this.post({
        type: "setup",
        ok: false,
        message: root.error,
        installHint: "",
        platformOk: true,
        needsFolderPick: (vscode.workspace.workspaceFolders?.length ?? 0) > 1,
      });
      void vscode.window.showErrorMessage(root.error);
      return;
    }

    this.postFolder();
    const setup = await this.probeSetup();
    this.post({ type: "setup", ...setup });
    if (!setup.ok) {
      void vscode.window.showErrorMessage(setup.message);
      return;
    }

    if (!(await ensureHeadlessConsent())) {
      return;
    }

    const workspacePath = root.path;
    const sessionId = this.sessions.getSessionId();

    this.liveTranscript = appendLiveUiEvent(this.liveTranscript, {
      kind: "user",
      prompt: trimmed,
    });
    this.sessions.saveTranscript(sessionId, this.liveTranscript);

    this.post({ type: "user", prompt: trimmed });
    this.post({ type: "running", running: true });
    this.setRunning(true, sessionId);

    try {
      this.run = startMuseExec({
        prompt: trimmed,
        workspacePath,
        sessionId,
        onEvent: (event) => this.handleEvent(event),
        onRejectedExtraArgs: (rejected) => {
          this.post({
            type: "status",
            text: `Ignored blocked extraArgs: ${rejected.join(", ")}`,
          });
          void vscode.window.showWarningMessage(
            `Muse CLI Chat ignored blocked muse.extraArgs: ${rejected.join(", ")}. Use muse.yolo only via the dedicated setting.`,
          );
        },
        onStderr: (text) => {
          const line = text.trim();
          if (line) {
            this.post({ type: "stderr", text: line });
          }
        },
        onExit: (code, signal) => {
          this.run = undefined;
          this.setRunning(false);
          this.post({ type: "running", running: false });
          if (signal === "SIGINT" || signal === "SIGTERM") {
            this.post({ type: "status", text: "Interrupted" });
          } else if (code !== 0 && code !== null) {
            this.post({
              type: "status",
              text: `muse exited with code ${code}`,
            });
          }
          this.sessions.saveTranscript(sessionId, this.liveTranscript);
          void this.hydrateTranscript({ paintCacheFirst: false });
        },
      });
    } catch (err) {
      this.run = undefined;
      this.setRunning(false);
      this.post({ type: "running", running: false });
      const msg = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", text: msg });
      void vscode.window.showErrorMessage(msg);
    }
  }

  async sendSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage("Select some code first.");
      return;
    }
    const selection = editor.document.getText(editor.selection);
    const rel = vscode.workspace.asRelativePath(editor.document.uri);
    const prompt = `Regarding \`${rel}\`:\n\n\`\`\`\n${selection}\n\`\`\`\n\nPlease review and suggest improvements.`;
    this.reveal();
    await this.submitPrompt(prompt);
  }

  async openInteractiveTerminal(): Promise<void> {
    if (!isSupportedPlatform()) {
      void vscode.window.showErrorMessage(unsupportedPlatformMessage());
      return;
    }
    const folder = await this.folders.resolveFolder();
    let cwd: string | undefined;
    if (folder) {
      const root = inspectWorkspaceRoot(folder.fsPath);
      if (!root.ok) {
        void vscode.window.showErrorMessage(root.error);
        return;
      }
      cwd = root.path;
    }
    const settings = readMuseSettings();
    const resolved = resolveMuseBinary(settings.executablePath);
    if (!resolved.ok) {
      void vscode.window.showErrorMessage(resolved.error);
      return;
    }
    // Launch Muse as the terminal process (no shell, no sendText injection).
    const terminal = vscode.window.createTerminal({
      name: "Muse Code",
      cwd,
      shellPath: resolved.path,
    });
    terminal.show();
  }

  async checkInstallation(): Promise<void> {
    const setup = await this.probeSetup();
    this.post({ type: "setup", ...setup });
    if (setup.ok) {
      void vscode.window.showInformationMessage(setup.message);
    } else {
      const detail = setup.installHint
        ? `${setup.message}\n\n${setup.installHint}`
        : setup.message;
      void vscode.window.showErrorMessage(detail);
    }
  }

  dispose(): void {
    this.stop();
    this.status.dispose();
  }

  private async hydrateTranscript(opts: {
    paintCacheFirst: boolean;
  }): Promise<void> {
    const sessionId = this.sessions.getSessionId();
    const epoch = ++this.hydrateEpoch;

    if (opts.paintCacheFirst) {
      const cached = this.sessions.getCachedTranscript(sessionId);
      this.liveTranscript = cached;
      this.post({
        type: "history",
        items: this.enrichItemsForWebview(cached),
        source: "cache",
      });
    }

    const folder = this.folders.getFolder();
    if (!folder) {
      return;
    }
    const root = inspectWorkspaceRoot(folder.fsPath);
    if (!root.ok) {
      return;
    }

    const listed = listMuseSessionsForWorkspace(root.path, { limit: 80 });
    const match = listed.find((s) => s.sessionId === sessionId);
    if (!match && !opts.paintCacheFirst) {
      // Brand-new id with no Muse log yet.
      return;
    }

    const loaded = await loadSessionTranscript({
      sessionId,
      workspacePath: root.path,
      sessionLogPath: match?.sessionLogPath,
    });

    if (epoch !== this.hydrateEpoch || this.run) {
      return;
    }

    if (loaded.items.length === 0 && this.liveTranscript.length > 0) {
      return;
    }

    this.liveTranscript = loaded.items;
    this.sessions.saveTranscript(sessionId, loaded.items);
    this.post({
      type: "history",
      items: this.enrichItemsForWebview(loaded.items),
      source: loaded.source,
    });
  }

  private postFolder(): void {
    const folder = this.folders.getFolder();
    const multi = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    this.post({
      type: "folder",
      name: folder?.name ?? null,
      path: folder?.fsPath ?? null,
      multi,
    });
  }

  private async probeSetup(): Promise<{
    ok: boolean;
    version?: string;
    message: string;
    installHint: string;
    platformOk: boolean;
    needsFolderPick?: boolean;
  }> {
    const installHint =
      "curl -fsSL https://dev.meta.ai/install.sh | sh";
    const multi = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;

    if (!isSupportedPlatform()) {
      return {
        ok: false,
        message: unsupportedPlatformMessage(),
        installHint,
        platformOk: false,
      };
    }

    const roots = vscode.workspace.workspaceFolders ?? [];
    if (roots.length === 0) {
      try {
        const version = await checkMuseInstallation();
        return {
          ok: false,
          version,
          message: `Muse found (${version}). Open a folder (not a symlink root) to chat.`,
          installHint: "",
          platformOk: true,
        };
      } catch {
        // Fall through to CLI missing message below.
      }
    } else {
      const folder = this.folders.getFolder();
      if (!folder) {
        return {
          ok: false,
          message:
            "Multi-root workspace: choose which folder Muse should use.",
          installHint: "",
          platformOk: true,
          needsFolderPick: true,
        };
      }
      const root = inspectWorkspaceRoot(folder.fsPath);
      if (!root.ok) {
        return {
          ok: false,
          message: root.error,
          installHint: "",
          platformOk: true,
          needsFolderPick: multi,
        };
      }
    }

    try {
      const version = await checkMuseInstallation();
      const settings = readMuseSettings();
      const auth = probeMuseAuth({ useEchoProvider: settings.useEchoProvider });
      if (!auth.ok) {
        return {
          ok: false,
          version,
          message: `${auth.message}\nCLI: ${version}`,
          installHint: auth.hint,
          platformOk: true,
        };
      }
      const folder = this.folders.getFolder();
      const parts = [
        `Muse ready (${version})`,
        auth.detail,
        folder ? folder.name : null,
      ].filter(Boolean);
      return {
        ok: true,
        version,
        message: parts.join(" · "),
        installHint,
        platformOk: true,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Muse CLI not found. Install it, sign in (or set META_API_KEY), then re-check.\n${detail}`,
        installHint,
        platformOk: true,
      };
    }
  }

  private handleEvent(event: MuseUiEvent): void {
    this.liveTranscript = appendLiveUiEvent(this.liveTranscript, event);
    switch (event.kind) {
      case "user":
        // Already posted locally; skip duplicate from stream.
        break;
      case "assistant_delta":
        this.post({ type: "assistant_delta", text: event.text });
        break;
      case "assistant_final":
        this.post({
          type: "assistant_final",
          text: event.text,
          html: this.assistantHtml(event.text),
          files: this.fileChips(event.text),
          terminal: event.terminal,
          reason: event.reason ?? null,
        });
        break;
      case "status":
        this.post({ type: "status", text: event.text });
        break;
      case "tool":
        this.post({
          type: "tool",
          name: event.name,
          resultRaw: event.resultRaw,
          resultView: event.resultView,
          files: this.fileChips(event.resultView || event.resultRaw),
          execMeta: event.execMeta,
        });
        break;
      case "task":
        this.post({ type: "task", text: event.text });
        break;
      case "unknown":
        this.post({
          type: "unknown",
          payloadType: event.payloadType,
          payload: event.payload,
        });
        break;
      case "parse_error":
        this.post({ type: "error", text: event.error || event.line });
        break;
    }
  }

  private setRunning(running: boolean, sessionId?: string): void {
    if (running) {
      const short = (sessionId ?? this.sessions.getSessionId()).slice(0, 8);
      this.status.text = `$(sync~spin) Muse ${short}`;
      this.status.tooltip = "Muse CLI Chat run in progress";
      this.status.show();
    } else {
      this.status.hide();
    }
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private enrichItemsForWebview(items: TranscriptItem[]): unknown[] {
    return items.map((item) => this.enrichItemForWebview(item));
  }

  private enrichItemForWebview(item: TranscriptItem): unknown {
    if (item.type === "assistant") {
      return {
        type: "assistant",
        text: item.text,
        html: this.assistantHtml(item.text),
        files: this.fileChips(item.text),
      };
    }
    if (item.type !== "tool") {
      return item;
    }
    const raw = item.resultRaw ?? item.text ?? "";
    const formatted = formatToolResult(raw);
    return {
      type: "tool",
      name: item.name,
      resultRaw: formatted.resultRaw,
      resultView: formatted.resultView,
      files: this.fileChips(formatted.resultView || formatted.resultRaw),
      execMeta: formatted.execMeta,
    };
  }

  /** Verified file chips for a message body (paths that exist on disk). */
  private fileChips(text: string | undefined): FileChip[] {
    if (!text) {
      return [];
    }
    return buildFileChips(text, this.folders.getFolder()?.fsPath);
  }

  private chatFormat(): "markdown" | "plain" {
    return vscode.workspace
      .getConfiguration("muse")
      .get<"markdown" | "plain">("chatFormat", "markdown");
  }

  private assistantHtml(text: string): string | null {
    if (this.chatFormat() !== "markdown" || !text.trim()) {
      return null;
    }
    return buildChatMarkdownHtml(text);
  }

  /** Links in chat: web URLs go to the browser, local paths to the main view. */
  private async handleOpenLink(href: string): Promise<void> {
    await this.openCanvasFile(href);
  }

  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "chat.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "chat.js"),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Muse CLI Chat</title>
</head>
<body>
  <header class="top">
    <div class="brand-wrap">
      <div class="brand">Muse CLI Chat</div>
      <div class="unofficial">Unofficial · wraps Meta Muse Code</div>
    </div>
    <div class="meta">
      <div id="folder" class="folder"></div>
      <button type="button" id="session-btn" class="session-btn" title="Resume or start a Muse session">
        <span id="session" class="session">————</span>
      </button>
    </div>
  </header>
  <div id="setup" class="setup" hidden>
    <p id="setup-msg" class="setup-msg"></p>
    <pre id="setup-install" class="setup-install"></pre>
    <div class="setup-actions">
      <button type="button" id="pick-folder" class="secondary" hidden>Choose folder</button>
      <button type="button" id="recheck" class="secondary">Re-check</button>
      <button type="button" id="docs" class="secondary">Docs</button>
    </div>
  </div>
  <main id="transcript" class="transcript" aria-live="polite"></main>
  <footer class="composer">
    <textarea id="input" rows="3" placeholder="Ask Muse to plan, edit, or validate…"></textarea>
    <div class="actions">
      <button type="button" id="history" class="secondary">History</button>
      <button type="button" id="stop" class="secondary" disabled>Stop</button>
      <button type="button" id="send" class="primary">Send</button>
    </div>
    <p class="hint">History resumes Muse’s --session-id (export-backed). First send may ask to enable disable-approval. Not affiliated with Meta.</p>
  </footer>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
