import * as vscode from "vscode";
import type { CanvasPanel, CanvasPayload } from "./canvasPanel";
import {
  buildAttachedPrompt,
  formatDiagnosticsBlock,
  formatEditorsBlock,
  formatFileBlock,
  formatTerminalBlock,
  MAX_EDITOR_CHARS,
  MAX_EDITORS,
  readAttachmentFile,
  stripAttachedContext,
  summarizeAttachments,
  type AttachmentRequest,
  type EditorSnapshot,
  type SimplifiedDiagnostic,
} from "./contextAttachments";
import { buildFileChips, type FileChip } from "./fileChips";
import { probeMuseAuth } from "./museAuth";
import { TerminalOutputStore } from "./terminalOutput";
import { openLinkInMainView } from "./openInMainView";
import {
  checkMuseInstallation,
  resolveMuseBinary,
  readMuseSettings,
  startMuseExec,
  type MuseRunHandle,
} from "./museCli";
import { loadSessionTranscript } from "./museExport";
import {
  filterMentionCandidates,
  mentionSearchGlob,
  type MentionCandidate,
} from "./fileMentions";
import { parsePorcelain, readGitSnapshot, reviewSince, runGit } from "./gitReview";
import {
  executionModeDescription,
  EXECUTION_MODE_LABELS,
  normalizeExecutionMode,
} from "./executionMode";
import {
  MUSE_AI_URL,
  selectHandoffTranscript,
  transcriptToMarkdown,
} from "./transcriptMarkdown";
import type { MuseUiEvent } from "./museJsonl";
import { buildMuseStatusText, buildMuseStatusTooltip } from "./museUi";
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
  public static readonly editorViewType = "muse.chatPanel";

  private readonly webviews = new Set<vscode.Webview>();
  private run?: MuseRunHandle;
  private editorPanel?: vscode.WebviewPanel;
  private readonly status: vscode.StatusBarItem;
  private readonly terminalOutput = new TerminalOutputStore();
  private liveTranscript: TranscriptItem[] = [];
  private hydrateEpoch = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionStore,
    private readonly folders: WorkspaceFolderStore,
    private readonly canvasPanel: CanvasPanel,
  ) {
    this.status = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.status.command = "muse.openChat";
    this.terminalOutput.start();
    this.refreshStatusBar();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    const dispose = this.attachWebview(webviewView.webview);
    webviewView.onDidDispose(dispose);
  }

  /** Attach a panel or view to the shared chat session. */
  attachWebview(webview: vscode.Webview): () => void {
    this.webviews.add(webview);
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webview.html = this.getHtml(webview);

    const messageSubscription = webview.onDidReceiveMessage(async (msg) => {
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
          await this.submitPrompt(
            String(msg.prompt ?? ""),
            sanitizeAttachments(msg.attachments),
          );
          break;
        case "currentFileQuery":
          this.handleCurrentFileQuery(Number(msg.requestId ?? 0));
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
        case "cycleMode":
          await this.cycleExecutionMode();
          break;
        case "openSettings":
          await this.openSettings();
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
        case "openMuseAi":
          await this.openMuseAi();
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
        case "mentionQuery":
          await this.handleMentionQuery(
            String(msg.query ?? ""),
            Number(msg.requestId ?? 0),
          );
          break;
      }
    });

    return () => {
      messageSubscription.dispose();
      this.webviews.delete(webview);
    };
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

  private async handleMentionQuery(
    query: string,
    requestId: number,
  ): Promise<void> {
    const folder = this.folders.getFolder();
    if (!folder) {
      this.post({ type: "mentionResults", requestId, items: [] });
      return;
    }

    const items: MentionCandidate[] = [];
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "file" || doc.isUntitled) {
        continue;
      }
      const rel = vscode.workspace.asRelativePath(doc.uri, false);
      if (!rel || rel === doc.uri.fsPath) {
        continue;
      }
      items.push({ path: rel.replace(/\\/g, "/"), source: "open" });
    }

    const git = await runGit(folder.fsPath, [
      "status",
      "--porcelain",
      "--untracked-files=normal",
    ]);
    if (git.ok) {
      for (const file of parsePorcelain(git.stdout)) {
        items.push({ path: file.path.replace(/\\/g, "/"), source: "git" });
      }
    }

    const glob = mentionSearchGlob(query);
    if (glob) {
      try {
        const hits = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder.uri, glob),
          new vscode.RelativePattern(
            folder.uri,
            "{**/node_modules,**/dist,**/.git}/**",
          ),
          40,
        );
        for (const uri of hits) {
          const rel = vscode.workspace.asRelativePath(uri, false);
          if (!rel || rel === uri.fsPath) {
            continue;
          }
          items.push({ path: rel.replace(/\\/g, "/"), source: "search" });
        }
      } catch {
        // ignore bad globs
      }
    }

    this.post({
      type: "mentionResults",
      requestId,
      items: filterMentionCandidates(query, items, 12),
    });
  }

  private async publishTurnReview(
    workspacePath: string,
    before: Awaited<ReturnType<typeof readGitSnapshot>>,
  ): Promise<void> {
    try {
      const review = await reviewSince(workspacePath, before);
      if (!review.markdown) {
        return;
      }
      this.post({
        type: "changes",
        files: review.files,
        markdown: review.markdown,
      });
      this.canvasPanel.show({
        name: "Changed files",
        resultView: review.markdown,
        resultRaw: review.diff || review.markdown,
      });
    } catch {
      // Review is best-effort and must not fail the chat run.
    }
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
    const executionMode = normalizeExecutionMode(
      cfg.get<string>("executionMode", "headless"),
    );
    this.post({
      type: "config",
      toolOutputFormat: cfg.get<"readable" | "json">(
        "toolOutputFormat",
        "readable",
      ),
      toolDisplay: cfg.get<"minimal" | "compact" | "balanced" | "detailed">(
        "toolDisplay",
        "compact",
      ),
      chatFormat: cfg.get<"markdown" | "plain">("chatFormat", "markdown"),
      executionMode,
      executionModeLabel: EXECUTION_MODE_LABELS[executionMode],
      executionModeDescription: executionModeDescription(executionMode),
      model: cfg.get<string>("model", ""),
      reasoningEffort: cfg.get<string>("reasoningEffort", ""),
    });
    this.refreshStatusBar();
  }

  refreshStatusBar(): void {
    const cfg = vscode.workspace.getConfiguration("muse");
    const executionMode = normalizeExecutionMode(
      cfg.get<string>("executionMode", "headless"),
    );
    const label = EXECUTION_MODE_LABELS[executionMode];
    this.status.text = buildMuseStatusText({
      running: Boolean(this.run),
      modeLabel: label,
      sessionId: this.sessions.getSessionId(),
    });
    this.status.tooltip = buildMuseStatusTooltip({
      modeLabel: label,
      modeDescription: executionModeDescription(executionMode),
      sessionId: this.sessions.getSessionId(),
      folderName: this.folders.getFolder()?.name ?? null,
    });
    this.status.show();
  }

  async exportTranscript(): Promise<void> {
    const markdown = await this.buildMuseAiHandoffMarkdown();
    if (!markdown.trim()) {
      void vscode.window.showInformationMessage(
        "No Muse transcript to export yet.",
      );
      return;
    }
    const short = this.sessions.getSessionId().slice(0, 8);
    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: markdown,
    });
    await vscode.window.showTextDocument(doc, { preview: false });
    void vscode.window.showInformationMessage(
      `Exported Muse session ${short}… to a new editor.`,
    );
  }

  async copyRequestId(): Promise<void> {
    const sessionId = this.sessions.getSessionId();
    try {
      await vscode.env.clipboard.writeText(sessionId);
    } catch {
      void vscode.window.showWarningMessage(
        "Could not copy the request ID to the clipboard.",
      );
      return;
    }
    void vscode.window.showInformationMessage(
      `Copied request ID ${sessionId.slice(0, 8)}…`,
    );
  }

  async openSettings(): Promise<void> {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "muse",
    );
  }

  async cycleExecutionMode(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("muse");
    const current = normalizeExecutionMode(
      cfg.get<string>("executionMode", "headless"),
    );
    const next = current === "headless" ? "interactive" : "headless";
    await cfg.update(
      "executionMode",
      next,
      vscode.ConfigurationTarget.Global,
    );
    this.postConfig();
  }

  expandAll(): void {
    this.post({ type: "expandAll" });
  }

  collapseAll(): void {
    this.post({ type: "collapseAll" });
  }

  async openMuseAi(): Promise<void> {
    const markdown = await this.buildMuseAiHandoffMarkdown();
    if (markdown) {
      try {
        await vscode.env.clipboard.writeText(markdown);
      } catch {
        void vscode.window.showWarningMessage(
          "Could not copy the session to the clipboard. Opening Muse.ai anyway.",
        );
      }
    }
    try {
      await vscode.env.openExternal(vscode.Uri.parse(MUSE_AI_URL));
    } catch {
      void vscode.window.showErrorMessage(`Could not open ${MUSE_AI_URL}`);
      return;
    }
    if (markdown) {
      void vscode.window.showInformationMessage(
        "Copied this Muse Code session to the clipboard. Paste it in Muse.ai to continue.",
      );
    }
  }

  reveal(): void {
    void vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
  }

  async openPanel(column = vscode.ViewColumn.Beside): Promise<void> {
    if (this.editorPanel) {
      this.editorPanel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ChatViewProvider.editorViewType,
      "Muse Code",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "muse.svg");
    this.editorPanel = panel;
    const dispose = this.attachWebview(panel.webview);
    panel.onDidDispose(() => {
      dispose();
      if (this.editorPanel === panel) {
        this.editorPanel = undefined;
      }
    });
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
    this.refreshStatusBar();
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
    this.refreshStatusBar();
    void vscode.window.showInformationMessage(
      `Resumed Muse session ${sessionId.slice(0, 8)}…`,
    );
  }

  async submitPrompt(prompt: string, attachments: AttachmentRequest[] = []): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed && attachments.length === 0) {
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
    const snapshot = await readGitSnapshot(workspacePath);

    // Expand context chips into inline blocks for the model. The transcript
    // keeps the expanded prompt (what the model saw); the sidebar shows the
    // compact prompt with chip labels.
    const { blocks, warnings } = this.resolveAttachments(attachments, workspacePath);
    const expanded = buildAttachedPrompt(
      trimmed || "See attached context.",
      blocks,
    );
    const chipLabels = summarizeAttachments(attachments);
    for (const warning of warnings) {
      this.post({ type: "status", text: warning });
    }

    this.liveTranscript = appendLiveUiEvent(this.liveTranscript, {
      kind: "user",
      prompt: expanded,
    });
    this.sessions.saveTranscript(sessionId, this.liveTranscript);

    this.post({ type: "user", prompt: trimmed, attached: chipLabels });
    this.post({ type: "running", running: true });
    this.setRunning(true);

    try {
      this.run = startMuseExec({
        prompt: expanded,
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
          void this.publishTurnReview(workspacePath, snapshot);
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
    this.terminalOutput.dispose();
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

  private async buildMuseAiHandoffMarkdown(): Promise<string> {
    const sessionId = this.sessions.getSessionId();
    const folder = this.folders.getFolder();
    let exported: TranscriptItem[] = [];
    if (folder && !this.run) {
      const root = inspectWorkspaceRoot(folder.fsPath);
      if (root.ok) {
        const listed = listMuseSessionsForWorkspace(root.path, { limit: 80 });
        const match = listed.find((s) => s.sessionId === sessionId);
        const loaded = await loadSessionTranscript({
          sessionId,
          workspacePath: root.path,
          sessionLogPath: match?.sessionLogPath,
        });
        exported = loaded.items;
      }
    }
    const items = selectHandoffTranscript({
      liveItems: this.liveTranscript,
      exportedItems: exported,
      running: Boolean(this.run),
    });
    return transcriptToMarkdown(items, {
      sessionId,
      workspaceName: folder?.name,
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
    this.refreshStatusBar();
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

  private setRunning(running: boolean): void {
    void running;
    this.refreshStatusBar();
  }

  private handleCurrentFileQuery(requestId: number): void {
    const doc = vscode.window.activeTextEditor?.document;
    let path: string | null = null;
    if (doc && doc.uri.scheme === "file" && !doc.isUntitled) {
      const rel = vscode.workspace.asRelativePath(doc.uri, false);
      if (rel && rel !== doc.uri.fsPath) {
        path = rel.replace(/\\/g, "/");
      }
    }
    this.post({ type: "currentFileResult", requestId, path });
  }

  private resolveAttachments(
    attachments: AttachmentRequest[],
    workspacePath: string,
  ): { blocks: string[]; warnings: string[] } {
    const blocks: string[] = [];
    const warnings: string[] = [];
    const seenFiles = new Set<string>();
    let fileCount = 0;
    for (const attachment of attachments) {
      switch (attachment.kind) {
        case "file": {
          const rel = (attachment.path || "").replace(/\\/g, "/").trim();
          if (!rel || seenFiles.has(rel)) {
            break;
          }
          seenFiles.add(rel);
          fileCount += 1;
          if (fileCount > 10) {
            warnings.push(`Skipped ${rel}: too many file attachments (max 10).`);
            break;
          }
          const read = readAttachmentFile(workspacePath, rel);
          if (!read.ok) {
            warnings.push(read.error);
            blocks.push(`<file path="${rel}">\n(${read.error})\n</file>`);
          } else {
            blocks.push(formatFileBlock(rel, read.content, { truncated: read.truncated }));
          }
          break;
        }
        case "problems": {
          const diags = collectWorkspaceDiagnostics(workspacePath);
          blocks.push(formatDiagnosticsBlock(diags));
          break;
        }
        case "terminal": {
          blocks.push(formatTerminalBlock(this.terminalOutput.recent()));
          break;
        }
        case "editors": {
          blocks.push(formatEditorsBlock(collectOpenEditors(workspacePath)));
          break;
        }
      }
    }
    return { blocks, warnings };
  }

  private post(message: unknown): void {
    for (const webview of this.webviews) {
      void webview.postMessage(message);
    }
  }

  private enrichItemsForWebview(items: TranscriptItem[]): unknown[] {
    return items.map((item) => this.enrichItemForWebview(item));
  }

  private enrichItemForWebview(item: TranscriptItem): unknown {
    if (item.type === "user") {
      const stripped = stripAttachedContext(item.text);
      if (stripped.attached.length === 0) {
        return item;
      }
      return { type: "user", text: stripped.display, attached: stripped.attached };
    }
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
    <div class="top-row">
      <div class="brand">Muse CLI Chat</div>
      <div class="toolbar" role="toolbar" aria-label="Session">
        <button type="button" id="toolbar-history" class="icon-btn" title="Session history">History</button>
        <button type="button" id="toolbar-new" class="icon-btn" title="New session">+ New</button>
      </div>
    </div>
    <div class="sub-row">
      <div class="unofficial">
        Unofficial · wraps Meta Muse Code
        <!-- <button type="button" id="muse-ai" class="muse-ai-link" title="Copy this session and open muse.ai">muse.ai</button> -->
      </div>
      <div class="meta">
        <div id="folder" class="folder"></div>
        <div id="execution-mode" class="execution-mode" title=""></div>
        <button type="button" id="session-btn" class="session-btn" title="Resume or start a Muse session">
          <span id="session" class="session">————</span>
        </button>
      </div>
    </div>
  </header>
  <div id="mode-banner" class="mode-banner" hidden>
    <span id="mode-banner-text" class="mode-banner-text"></span>
    <button type="button" id="mode-banner-dismiss" class="secondary mode-banner-dismiss">Dismiss</button>
  </div>
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
    <div class="composer-head">
      <span id="focus-hint" class="focus-hint"></span>
    </div>
    <div id="attachments" class="attachments" hidden aria-label="Attached context"></div>
    <div id="mentions" class="mentions" hidden role="listbox" aria-label="File mentions"></div>
    <textarea id="input" rows="3" placeholder="Ask Muse… (@ file, ⌘Enter to send)"></textarea>
    <div class="actions">
      <div class="attach-wrap">
        <button type="button" id="attach" class="secondary" title="Attach file contents, problems, terminal output, or open editors">+ Attach</button>
        <div id="attach-menu" class="attach-menu" hidden role="menu">
          <button type="button" data-attach="file" role="menuitem">File… (@)</button>
          <button type="button" data-attach="current" role="menuitem">Current file</button>
          <button type="button" data-attach="editors" role="menuitem">Open editors</button>
          <button type="button" data-attach="problems" role="menuitem">Problems</button>
          <button type="button" data-attach="terminal" role="menuitem">Terminal output</button>
        </div>
      </div>
      <div class="pills" role="group" aria-label="Run settings">
        <button type="button" id="mode-pill" class="pill" title="Switch execution mode"></button>
        <button type="button" id="model-pill" class="pill" title="Model (opens settings)"></button>
        <button type="button" id="effort-pill" class="pill" title="Reasoning effort (opens settings)"></button>
      </div>
      <button type="button" id="history" class="secondary">History</button>
      <button type="button" id="stop" class="secondary" disabled>Stop</button>
      <button type="button" id="send" class="primary send-btn" title="Send (⌘Enter)">↑ Send</button>
    </div>
    <p class="hint">Type @ to attach a file with contents. + Attach adds problems, terminal output, or open editors. After a turn, changed-file diffs open in canvas. Not affiliated with Meta.</p>
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

/** Validate webview attachment descriptors (untrusted input). */
function sanitizeAttachments(value: unknown): AttachmentRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: AttachmentRequest[] = [];
  for (const raw of value.slice(0, 16)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const kind = (raw as { kind?: unknown }).kind;
    if (kind === "file") {
      const path = String((raw as { path?: unknown }).path ?? "").slice(0, 1024);
      if (path.trim()) {
        out.push({ kind: "file", path: path.trim() });
      }
      continue;
    }
    if (kind === "problems" || kind === "terminal" || kind === "editors") {
      if (!out.some((a) => a.kind === kind)) {
        out.push({ kind });
      }
    }
  }
  return out;
}

function severityName(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    case vscode.DiagnosticSeverity.Hint:
      return "hint";
    default:
      return "diagnostic";
  }
}

function collectWorkspaceDiagnostics(workspacePath: string): SimplifiedDiagnostic[] {
  const out: SimplifiedDiagnostic[] = [];
  const prefix = workspacePath.endsWith("/") ? workspacePath : `${workspacePath}/`;
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== "file" || !uri.fsPath.startsWith(prefix)) {
      continue;
    }
    const rel = uri.fsPath.slice(prefix.length);
    for (const d of diags) {
      out.push({
        path: rel,
        line: d.range.start.line + 1,
        character: d.range.start.character + 1,
        severity: severityName(d.severity),
        message: d.message,
        source: d.source,
      });
    }
  }
  const rank = { error: 0, warning: 1, info: 2, hint: 3, diagnostic: 4 };
  out.sort((a, b) => {
    const bySeverity = (rank[a.severity as keyof typeof rank] ?? 4) - (rank[b.severity as keyof typeof rank] ?? 4);
    if (bySeverity !== 0) {
      return bySeverity;
    }
    return a.path.localeCompare(b.path) || a.line - b.line || a.character - b.character;
  });
  return out;
}

function collectOpenEditors(workspacePath: string): EditorSnapshot[] {
  const prefix = workspacePath.endsWith("/") ? workspacePath : `${workspacePath}/`;
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const visible = new Set(
    (vscode.window.visibleTextEditors ?? [])
      .map((e) => e.document.uri.fsPath)
      .filter(Boolean),
  );
  const docs = vscode.workspace.textDocuments.filter(
    (doc) => doc.uri.scheme === "file" && !doc.isUntitled && doc.uri.fsPath.startsWith(prefix),
  );
  docs.sort((a, b) => {
    const rank = (fsPath: string): number => {
      if (fsPath === active) {
        return 0;
      }
      if (visible.has(fsPath)) {
        return 1;
      }
      return 2;
    };
    return rank(a.uri.fsPath) - rank(b.uri.fsPath) || a.uri.fsPath.localeCompare(b.uri.fsPath);
  });
  return docs.slice(0, MAX_EDITORS).map((doc) => {
    const text = doc.getText();
    const truncated = text.length > MAX_EDITOR_CHARS;
    return {
      path: doc.uri.fsPath.slice(prefix.length),
      content: truncated ? text.slice(0, MAX_EDITOR_CHARS) : text,
      truncated,
    };
  });
}
