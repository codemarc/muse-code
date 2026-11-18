import * as vscode from "vscode";
import { isUnderWorkspace } from "./canvasFile";
import { checkpointText, TurnCheckpointStore, type TurnCheckpoint } from "./turnCheckpoints";
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
import { parsePorcelain, runGit } from "./gitReview";
import {
  executionModeDescription,
  EXECUTION_MODE_LABELS,
  normalizeExecutionMode,
  type ExecutionMode,
} from "./executionMode";
import { executionModeTarget, needsApprovalCapableMode, readSessionApprovalPolicy } from "./sessionExecution";
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
  retainedBranchForWorkspace,
  type MuseSessionSummary,
} from "./museSessions";
import { isSupportedPlatform, unsupportedPlatformMessage } from "./platform";
import { buildChatMarkdownHtml } from "./previewContent";
import { ensureHeadlessConsent } from "./safety";
import { PanelApprovals } from "./panelApprovals";
import { PanelQuestions } from "./panelQuestions";
import { startMusePanel } from "./musePanel";
import { workspaceLease } from "./workspaceLease";
import { runSessionAction, validateSessionName } from "./sessionActions";
import type { SessionStore } from "./sessionStore";
import { formatToolResult } from "./toolResultFormat";
import {
  buildEffortOptions,
  buildModelOptions,
  CUSTOM_MODEL_VALUE,
  isValidEffort,
  isValidModelId,
  readMuseSettingsRaw,
} from "./pickerOptions";
import { appendLiveUiEvent, preserveStoppedTranscript, preserveToolMetadata, type TranscriptItem } from "./transcript";
import { inspectWorkspaceRoot, relativeToWorkspace } from "./workspace";
import type { WorkspaceFolderStore } from "./workspaceFolder";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "muse.chatView";
  private chatView: vscode.WebviewView | undefined;
  public static readonly editorViewType = "muse.chatPanel";
  onDidFocus?: () => void;
  onBranch?: (sessionId: string, folder: vscode.Uri) => void;
  onSessionMetadataChanged?: () => void;

  private readonly webviews = new Set<vscode.Webview>();
  private run?: MuseRunHandle;
  private readonly approvals = new PanelApprovals((items) => this.post({ type: "approvals", items }));
  private readonly questions = new PanelQuestions((items) => this.post({ type: "questions", items }));
  private runGeneration = 0;
  private editorPanel?: vscode.WebviewPanel;
  private readonly status: vscode.StatusBarItem;
  private readonly terminalOutput = new TerminalOutputStore();
  private liveTranscript: TranscriptItem[] = [];
  private hydrateEpoch = 0;
  private preparing = false;
  private sessionAction?: "rename" | "fork";
  private disposed = false;
  private checkpointBusy = false;
  private compatibilityEpoch = 0;
  private finishCheckpoint?: () => Promise<void>;
  private static readonly checkpointDocuments = new Map<string, string>();
  private readonly checkpointRegistration: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionStore,
    private readonly folders: WorkspaceFolderStore,
    private readonly canvasPanel: CanvasPanel,
    private readonly checkpoints: TurnCheckpointStore,
    /** View id that is shown in this host (secondary side bar when supported). */
    private readonly chatViewId: string = ChatViewProvider.viewType,
    private readonly chatIdentity?: { id: string; activate: () => void; closed: () => void },
  ) {
    this.checkpointRegistration = chatIdentity ? new vscode.Disposable(() => {}) : vscode.workspace.registerTextDocumentContentProvider("muse-turn", {
      provideTextDocumentContent: async (uri) => {
        const cached = ChatViewProvider.checkpointDocuments.get(uri.toString());
        if (cached !== undefined) return cached;
        const folder = uri.fragment ? vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === uri.fragment)?.uri : this.folders.getFolder()?.uri;
        if (!folder || (uri.query !== "before" && uri.query !== "after")) return "Snapshot unavailable";
        try {
          const [id, ...parts] = uri.path.slice(1).split("/");
          const turn = await this.checkpoints.load(folder.fsPath, id);
          const file = turn.files.find((file) => file.path === parts.join("/"));
          return file ? checkpointText(uri.query === "before" ? file.before : file.after) : "Snapshot unavailable";
        } catch { return "Snapshot unavailable"; }
      },
    });
    this.status = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    // Always toggles the chat view, so it can be reopened after its side bar is closed
    // (the editor-title button only shows while an editor is open).
    this.status.command = "muse.toggleChat";
    this.terminalOutput.start();
    this.refreshStatusBar();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    const dispose = this.attachWebview(webviewView.webview);
    this.chatView = webviewView;
    webviewView.onDidDispose(() => {
      if (this.chatView === webviewView) {
        this.chatView = undefined;
      }
      dispose();
    });
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
      if (msg?.type && msg.type !== "ready") this.onDidFocus?.();
      switch (msg?.type) {
        case "ready":
          this.post({ type: "questions", items: this.questions.list() });
          this.post({ type: "chatIdentity", chatId: this.chatIdentity?.id ?? "sidebar" });
          this.post({ type: "approvals", items: this.approvals.list() });
          this.post({ type: "running", running: !!this.run });
          this.post({ type: "sessionAction", busy: !!this.sessionAction, action: this.sessionAction });
          this.postSession();
          this.postFolder();
          this.postConfig();
          await this.refreshSetup();
          if (this.run) this.post({ type: "history", items: this.enrichItemsForWebview(this.liveTranscript), source: "live" });
          else await this.hydrateTranscript({ paintCacheFirst: true });
          await this.postTurnReviews();
          break;
        case "submit":
          try {
            await this.submitPrompt(
              String(msg.prompt ?? ""),
              sanitizeAttachments(msg.attachments),
            );
          } finally {
            webview.postMessage({ type: "submitFinished" });
          }
          break;
        case "currentFileQuery":
          this.handleCurrentFileQuery(Number(msg.requestId ?? 0));
          break;
        case "copyText":
          try {
            if (typeof msg.text !== "string" || msg.text.length > 2_000_000) throw new Error("Text is too large to copy.");
            await vscode.env.clipboard.writeText(msg.text);
            await webview.postMessage({ type: "copyResult", requestId: msg.requestId, ok: true });
          } catch {
            await webview.postMessage({ type: "copyResult", requestId: msg.requestId, ok: false });
          }
          break;
        case "openTurnDiff":
          await this.openTurnDiff(String(msg.turnId ?? ""), String(msg.path ?? ""));
          break;
        case "undoTurn":
          await this.restoreTurn(String(msg.turnId ?? ""), "undo");
          break;
        case "redoTurn":
          await this.restoreTurn(String(msg.turnId ?? ""), "redo");
          break;
        case "stop":
          this.stop();
          break;
        case "approvalDecision":
          try {
            this.approvals.decide(String(msg.approvalId ?? ""), Number(msg.sourceIndex), String(msg.choiceId ?? ""),
              typeof msg.feedback === "string" ? msg.feedback.slice(0, 8000) : undefined);
          } catch (error) {
            this.post({ type: "error", text: error instanceof Error ? error.message : String(error) });
            this.post({ type: "approvals", items: this.approvals.list() });
          }
          break;
        case "questionAnswer":
          try { await this.questions.answer(String(msg.userInputId ?? ""), msg.answers); }
          catch (error) { this.post({ type: "error", text: error instanceof Error ? error.message : String(error) }); }
          break;
        case "newSession":
          await vscode.commands.executeCommand("muse.newChat");
          break;
        case "activateChat":
          this.chatIdentity?.activate();
          break;
        case "pickSession":
          await this.pickSession();
          break;
        case "renameSession":
          await this.renameConversation();
          break;
        case "forkSession":
          await this.branchConversation();
          break;
        case "listSessions":
          this.postSessionList(String(msg.query ?? ""), Number(msg.requestId ?? 0));
          break;
        case "resumeSession":
          await this.resumeFromList(String(msg.sessionId ?? ""));
          break;
        case "cleanupSessions":
          await this.cleanupSessions();
          break;
        case "setSetting":
          await this.setSettingFromWebview(String(msg.key ?? ""), String(msg.value ?? ""));
          break;
        case "cycleMode":
          await this.cycleExecutionMode();
          break;
        case "resolveSessionMode":
          await this.resolveSessionMode(String(msg.sessionId ?? ""), String(msg.mode ?? ""), String(msg.action ?? ""));
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

  private async postTurnReviews(): Promise<void> {
    const folder = this.folders.getFolder();
    if (!folder) return;
    const sessionId = this.sessions.getSessionId();
    try {
      const turns = await this.checkpoints.list(folder.fsPath, sessionId);
      if (sessionId !== this.sessions.getSessionId()) return;
      this.post({ type: "turnReviews", turns: turns.map((turn) => ({
        turnId: turn.id, prompt: turn.prompt, createdAt: turn.createdAt, undone: turn.state === "undone",
        files: turn.files.map((file) => ({ path: file.path, status: file.before === null ? "A" : file.after === null ? "D" : "M" })),
      })) });
    } catch (err) { this.post({ type: "error", text: `Could not load turn checkpoints: ${String(err)}` }); }
  }

  private async openTurnDiff(id: string, path: string): Promise<void> {
    const folder = this.folders.getFolder();
    if (!folder) return;
    try {
      const turn = await this.checkpoints.load(folder.fsPath, id);
      if (turn.sessionId !== this.sessions.getSessionId()) return;
      const file = turn.files.find((file) => file.path === path);
      if (!file) return;
      const makeUri = (side: "before" | "after") => vscode.Uri.from({ scheme: "muse-turn", path: `/${turn.id}/${path}`, query: side, fragment: folder.fsPath });
      const before = makeUri("before");
      const after = makeUri("after");
      ChatViewProvider.checkpointDocuments.set(before.toString(), checkpointText(file.before));
      ChatViewProvider.checkpointDocuments.set(after.toString(), checkpointText(file.after));
      await vscode.commands.executeCommand("vscode.diff", before, after, `${path} · Muse turn · Before ↔ After`, { preview: true });
    } catch (err) { this.post({ type: "error", text: `Could not open turn diff: ${String(err)}` }); }
  }

  private async restoreTurn(id: string, action: "undo" | "redo"): Promise<void> {
    if (this.run || this.preparing || this.checkpointBusy) {
      this.post({ type: "error", text: "Wait for the current turn or checkpoint operation before restoring a turn." });
      await this.postTurnReviews();
      return;
    }
    const folder = this.folders.getFolder();
    if (!folder) return;
    this.checkpointBusy = true;
    let release: (() => void) | undefined;
    try {
      release = workspaceLease.acquire(folder.fsPath);
      const turn = await this.checkpoints.load(folder.fsPath, id);
      if (turn.sessionId !== this.sessions.getSessionId()) return;
      const dirty = vscode.workspace.textDocuments.filter((doc) => doc.isDirty && doc.uri.scheme === "file").map((doc) => doc.uri.fsPath);
      await this.checkpoints[action](folder.fsPath, id, dirty);
      this.post({ type: "status", text: action === "undo" ? "Turn undone. Your pre-turn edits and Git index were preserved." : "Turn reapplied. Your pre-turn edits and Git index were preserved." });
    } catch (err) { this.post({ type: "error", text: err instanceof Error ? err.message : String(err) }); }
    finally { release?.(); this.checkpointBusy = false; await this.postTurnReviews(); }
  }

  /** Chip clicks and chat links both land in the main editor area. */
  private async openCanvasFile(href: string): Promise<void> {
    await openLinkInMainView(href, {
      workspaceFolder: this.folders.getFolder()?.uri,
      showFile: (file) => this.canvasPanel.showFile(file),
    });
  }

  postConfig(): void {
    const cfg = vscode.workspace.getConfiguration("muse", this.folders.getFolder()?.uri);
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
      modelOptions: buildModelOptions(cfg.get<string>("model", ""), readMuseSettingsRaw()),
      effortOptions: buildEffortOptions(),
      useEchoProvider: cfg.get<boolean>("useEchoProvider", false),
    });
    this.refreshStatusBar();
    void this.refreshSessionCompatibility();
  }

  private currentExecutionMode(): ExecutionMode {
    return normalizeExecutionMode(vscode.workspace.getConfiguration("muse", this.folders.getFolder()?.uri).get("executionMode"));
  }

  private async sessionModeConflict(sessionId: string, mode: ExecutionMode) {
    if (mode !== "windows" && mode !== "headless") return null;
    let policy: "interactive" | "headless" | "unknown" = "unknown";
    try {
      const listed = this.listSessionsForCurrentFolder(sessionId);
      if (Array.isArray(listed)) {
        const stored = listed.find((session) => session.sessionId === sessionId);
        if (!stored && !this.sessions.getCachedTranscript(sessionId).length) return null;
        policy = await readSessionApprovalPolicy(stored?.sessionLogPath ?? null);
      }
    } catch { /* Unverifiable existing policy must not launch a headless run. */ }
    if (!needsApprovalCapableMode(mode, policy)) return null;
    return { sessionId, mode, text: policy === "interactive"
      ? "This session has a stored approval policy that needs Panel approvals. This mode cannot show those requests. Keep this session in Panel approvals, or start a new session for the selected mode. Your draft is kept; the previous session stays in history."
      : "This session's approval policy could not be verified. Use Panel approvals, or start a new session for the selected mode. Your draft is kept; the previous session stays in history." };
  }

  private async refreshSessionCompatibility(): Promise<void> {
    const epoch = ++this.compatibilityEpoch;
    const sessionId = this.sessions.getSessionId();
    const mode = this.currentExecutionMode();
    const conflict = this.run ? null : await this.sessionModeConflict(sessionId, mode);
    if (this.disposed || epoch !== this.compatibilityEpoch || sessionId !== this.sessions.getSessionId() || mode !== this.currentExecutionMode()) return;
    this.post({ type: "sessionCompatibility", sessionId, mode, conflict });
  }

  private async updateExecutionMode(mode: ExecutionMode): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("muse", this.folders.getFolder()?.uri);
    const scope = executionModeTarget(cfg.inspect("executionMode"));
    try {
      await cfg.update("executionMode", mode, scope === "folder" ? vscode.ConfigurationTarget.WorkspaceFolder
        : scope === "workspace" ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
    } catch (error) {
      this.post({ type: "error", text: `Could not change execution mode. Your draft is kept. ${error instanceof Error ? error.message : String(error)}` });
    }
    this.postConfig();
  }

  private async resolveSessionMode(sessionId: string, mode: string, action: string): Promise<void> {
    if (this.run || this.preparing || this.checkpointBusy || sessionId !== this.sessions.getSessionId() || mode !== this.currentExecutionMode()) return;
    const conflict = await this.sessionModeConflict(sessionId, this.currentExecutionMode());
    if (!conflict || this.run || this.preparing || this.checkpointBusy || sessionId !== this.sessions.getSessionId() || mode !== this.currentExecutionMode()) return;
    if (action === "panel") await this.updateExecutionMode("panel");
    else if (action === "newSession") this.newSession("Started a session for the selected mode. Your draft is ready to send");
  }

  refreshStatusBar(): void {
    if (this.chatIdentity) { this.status.hide(); return; }
    const executionMode = this.currentExecutionMode();
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
    const current = this.currentExecutionMode();
    const next = current === "panel" ? "headless" : current === "headless" ? "interactive" : "panel";
    await this.updateExecutionMode(next);
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
    void vscode.commands.executeCommand(`${this.chatViewId}.focus`);
  }

  /**
   * Editor-title / status-bar toggle: show the chat, or hide its side bar when
   * the chat is already showing, so one click flips between code and chat.
   */
  async toggle(): Promise<void> {
    if (this.chatView?.visible) {
      const close =
        this.chatViewId === ChatViewProvider.viewType
          ? "workbench.action.closeSidebar"
          : "workbench.action.closeAuxiliaryBar";
      await vscode.commands.executeCommand(close);
      return;
    }
    this.reveal();
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
    this.restorePanel(panel);
  }

  restorePanel(panel: vscode.WebviewPanel): void {
    this.editorPanel = panel;
    const dispose = this.attachWebview(panel.webview);
    panel.onDidChangeViewState(() => { if (panel.active) this.chatIdentity?.activate(); });
    if (panel.active) this.chatIdentity?.activate();
    panel.onDidDispose(() => {
      dispose();
      if (this.editorPanel === panel) {
        this.editorPanel = undefined;
      }
      this.chatIdentity?.closed();
    });
  }

  newSession(reason?: string): void {
    if (this.preparing) return;
    this.stop();
    this.hydrateEpoch += 1;
    const id = this.sessions.newSession();
    this.liveTranscript = [];
    this.postSession();
    this.post({ type: "history", items: [], source: "new" });
    this.post({
      type: "status",
      text: reason ? `${reason} (${id.slice(0, 8)})` : `New session ${id.slice(0, 8)}…`,
    });
    this.refreshStatusBar();
    void this.refreshSessionCompatibility();
  }

  stop(): void {
    if (this.run) {
      const stoppedRun = this.run;
      const finish = this.finishCheckpoint;
      this.runGeneration += 1;
      if (finish) {
        this.checkpointBusy = true;
        const finalize = () => { void finish().finally(() => { this.checkpointBusy = false; }); };
        if (stoppedRun.settled) void stoppedRun.settled.then(finalize, finalize);
        else stoppedRun.child?.once("close", finalize);
      }
      this.run.stop();
      this.run = undefined;
      this.setRunning(false);
      this.liveTranscript.push({ type: "status", text: "Stopped" });
      this.sessions.saveTranscript(this.sessions.getSessionId(), this.liveTranscript);
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
    if (this.preparing || this.run || this.checkpointBusy) return;
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

  /** Sessions for the in-chat history dropdown (same source as the quick pick). */
  private listSessionsForCurrentFolder(query = ""): MuseSessionSummary[] | { error: string } {
    const folder = this.folders.getFolder() ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return { error: "Open a folder to browse Muse sessions." };
    }
    const root = inspectWorkspaceRoot(folder.uri.fsPath);
    if (!root.ok) {
      return { error: root.error };
    }
    const labels = this.sessions.getLabels(root.path);
    const found = new Map(listMuseSessionsForWorkspace(root.path, { limit: 40, query }).map((s) => [s.sessionId, s]));
    for (const [id, label] of Object.entries(labels)) {
      if (!label.parent || found.has(id)) continue;
      const branch = retainedBranchForWorkspace(root.path, id, label.parent);
      if (branch && (!query || [id, label.name, branch.firstUserPrompt ?? ""].join("\n").toLowerCase().includes(query.toLowerCase()))) found.set(id, branch);
    }
    // Search custom names before the recent-result limit, still validating each id's workspace.
    if (query) for (const [id, label] of Object.entries(labels)) {
      if (label.name.toLowerCase().includes(query.toLowerCase())) {
        for (const s of listMuseSessionsForWorkspace(root.path, { limit: 1, query: id })) {
          if (s.sessionId === id) found.set(id, s);
        }
      }
    }
    return [...found.values()].map((s) => ({ ...s, title: labels[s.sessionId]?.name || s.title }))
      .sort((a, b) => b.updatedAtUs - a.updatedAtUs).slice(0, 40);
  }

  /** Header: session id plus its title from the Muse index (first prompt for new chats). */
  postSession(): void {
    const sessionId = this.sessions.getSessionId();
    let title = "";
    const list = this.listSessionsForCurrentFolder(sessionId);
    if (Array.isArray(list)) {
      const hit = list.find((s) => s.sessionId === sessionId);
      if (hit) {
        title = stripAttachedContext(hit.title || hit.firstUserPrompt || "").display.trim();
      }
    }
    const folder = this.folders.getFolder();
    const label = folder ? this.sessions.getLabels(folder.fsPath)[sessionId] : undefined;
    title = label?.name || title;
    this.post({ type: "session", sessionId, title: title.slice(0, 120), parentSessionId: label?.parent });
    if (this.editorPanel) this.editorPanel.title = title.slice(0, 50) || `Muse · ${sessionId.slice(0, 8)}`;
  }

  async renameConversation(): Promise<void> {
    if (this.run || this.preparing || this.checkpointBusy) {
      this.post({ type: "error", text: "Wait for the current Muse operation to finish before renaming." }); return;
    }
    const id = this.sessions.getSessionId();
    const folder = this.folders.getFolder();
    if (!folder) return;
    const value = await vscode.window.showInputBox({ title: "Rename Muse conversation",
      prompt: "Saved in this VS Code workspace. Muse CLI names stay unchanged.",
      value: this.sessions.getLabels(folder.fsPath)[id]?.name ?? "",
      validateInput: validateSessionName, ignoreFocusOut: true });
    if (value === undefined || this.sessions.getSessionId() !== id || this.folders.getFolder()?.fsPath !== folder.fsPath) return;
    const error = validateSessionName(value);
    if (error) { this.post({ type: "error", text: error }); return; }
    if (this.run || this.preparing || this.checkpointBusy || this.disposed) return;
    try {
      await this.sessions.saveLabel(folder.fsPath, id, value.trim());
      this.onSessionMetadataChanged?.(); this.postSession();
    } catch (error) {
      this.post({ type: "error", text: `Could not save conversation name: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async branchConversation(): Promise<void> {
    await this.conversationAction();
  }

  private async conversationAction(): Promise<void> {
    const action = "fork";
    if (this.run || this.preparing || this.checkpointBusy) {
      this.post({ type: "error", text: "Wait for the current Muse operation to finish before changing this conversation." }); return;
    }
    const folder = this.folders.getFolder();
    if (!folder) return;
    const root = inspectWorkspaceRoot(folder.fsPath);
    if (!root.ok) { this.post({ type: "error", text: root.error }); return; }
    const source = this.sessions.getSessionId();
    const listed = this.listSessionsForCurrentFolder(source);
    if (!Array.isArray(listed) || !listed.some((s) => s.sessionId === source)) {
      this.post({ type: "error", text: "Send a first message before branching this conversation." }); return;
    }
    let release: (() => void) | undefined;
    this.preparing = true;
    this.sessionAction = action;
    this.post({ type: "sessionAction", busy: true, action });
    try {
      release = workspaceLease.acquire(root.path);
      const settings = readMuseSettings();
      const binary = resolveMuseBinary(settings.executablePath);
      if (!binary.ok) throw new Error(binary.error);
      const result = await runSessionAction({ binary: binary.path, workspacePath: root.path,
        sessionId: source, trustWorkspace: settings.trustWorkspace, echo: settings.useEchoProvider });
      const sourceName = this.sessions.getLabels(root.path)[source]?.name || listed.find((s) => s.sessionId === source)?.title || "Muse";
      await this.sessions.saveLabel(root.path, result.sessionId, `Branch · ${sourceName}`.slice(0, 120), source);
      if (!this.disposed) this.onBranch?.(result.sessionId, folder.uri);
    } catch (error) {
      this.post({ type: "error", text: `Conversation branch failed: ${error instanceof Error ? error.message : String(error)}. Your draft and source conversation are kept.` });
    } finally {
      release?.(); this.preparing = false; this.sessionAction = undefined;
      this.post({ type: "sessionAction", busy: false, action });
    }
  }

  postSessionList(query = "", requestId = 0): void {
    query = query.trim().slice(0, 256);
    const list = this.listSessionsForCurrentFolder(query);
    const current = this.sessions.getSessionId();
    if (!Array.isArray(list)) {
      this.post({ type: "sessionList", requestId, query, items: [], error: list.error });
      return;
    }
    this.post({
      type: "sessionList",
      requestId,
      query,
      limit: 40,
      items: list.map((s) => ({
        id: s.sessionId,
        title: (
          stripAttachedContext(s.title || s.firstUserPrompt || "").display.trim() ||
          s.sessionId.slice(0, 8)
        ).slice(0, 120),
        preview: stripAttachedContext(s.firstUserPrompt || "").display.trim().slice(0, 200),
        updatedMs: s.updatedAtUs > 0 ? Math.round(s.updatedAtUs / 1000) : 0,
        turns: s.promptCount,
        current: s.sessionId === current,
      })),
    });
  }

  private async resumeFromList(sessionId: string): Promise<void> {
    if (this.run || this.preparing || this.checkpointBusy) {
      void vscode.window.showWarningMessage("Stop the current Muse run first.");
      return;
    }
    const list = this.listSessionsForCurrentFolder(sessionId);
    // Only resume ids the index actually lists for this folder (webview input is untrusted).
    if (!Array.isArray(list) || !list.some((s) => s.sessionId === sessionId)) {
      return;
    }
    await this.resumeSession(sessionId);
  }

  private async setSettingFromWebview(key: string, value: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("muse");
    if (key === "model") {
      let model = value;
      if (model === CUSTOM_MODEL_VALUE) {
        const typed = await vscode.window.showInputBox({
          title: "Muse model",
          prompt: "Model id passed to muse exec --model (empty = Muse default)",
          value: cfg.get<string>("model", ""),
          validateInput: (v) => (isValidModelId(v.trim()) ? undefined : "Letters, digits, . _ : - only"),
        });
        if (typed === undefined) {
          return;
        }
        model = typed.trim();
      }
      if (isValidModelId(model)) {
        await cfg.update("model", model, vscode.ConfigurationTarget.Global);
      }
      return;
    }
    if (key === "reasoningEffort" && isValidEffort(value)) {
      await cfg.update("reasoningEffort", value, vscode.ConfigurationTarget.Global);
      return;
    }
    if (key === "useEchoProvider" && (value === "true" || value === "false")) {
      // The config listener starts a new session: Muse will not switch providers mid-session.
      await cfg.update("useEchoProvider", value === "true", vscode.ConfigurationTarget.Global);
      return;
    }
    if (key === "executionMode" && (value === "headless" || value === "interactive" || value === "panel" || value === "windows")) {
      await this.updateExecutionMode(value);
    }
  }

  async pickSession(): Promise<void> {
    if (this.run || this.preparing || this.checkpointBusy) {
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

    const sessions = this.listSessionsForCurrentFolder();
    if (!Array.isArray(sessions)) { void vscode.window.showErrorMessage(sessions.error); return; }
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
    if (this.run || this.preparing || this.checkpointBusy) {
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
    if (this.preparing || this.checkpointBusy) return;
    this.stop();
    this.hydrateEpoch += 1;
    this.sessions.setSessionId(sessionId);
    this.liveTranscript = this.sessions.getCachedTranscript(sessionId);
    this.postSession();
    this.post({
      type: "history",
      items: this.enrichItemsForWebview(this.liveTranscript),
      source: "cache",
    });
    await this.hydrateTranscript({ paintCacheFirst: false });
    this.refreshStatusBar();
    void this.refreshSessionCompatibility();
    void vscode.window.showInformationMessage(
      `Resumed Muse session ${sessionId.slice(0, 8)}…`,
    );
  }

  async submitPrompt(prompt: string, attachments: AttachmentRequest[] = [], providerRetry = false): Promise<void> {
    if (this.preparing || this.checkpointBusy) {
      this.post({ type: "error", text: "Wait for the current checkpoint operation to finish." });
      return;
    }
    this.preparing = true;
    try { await this.startPrompt(prompt, attachments, providerRetry); }
    finally { this.preparing = false; }
  }

  private async startPrompt(prompt: string, attachments: AttachmentRequest[], providerRetry: boolean): Promise<void> {
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

    const executionMode = this.currentExecutionMode();
    const panelMode = executionMode === "panel";
    if (executionMode === "windows" && process.platform !== "win32") {
      this.post({ type: "error", text: "Windows compatibility requires native Windows. Choose Panel approvals or Headless on this system." });
      return;
    }
    const workspacePath = root.path;
    if (panelMode) {
      const current = this.sessions.getSessionId();
      const stored = this.listSessionsForCurrentFolder(current);
      if (current[14] !== "7" && Array.isArray(stored) && !stored.some((session) => session.sessionId === current)) {
        this.newSession("Started a panel-compatible session");
      }
    }
    const sessionId = this.sessions.getSessionId();
    let checkpoint: TurnCheckpoint;
    let release: (() => void) | undefined;
    try {
      release = workspaceLease.acquire(workspacePath);
      const conflict = await this.sessionModeConflict(sessionId, executionMode);
      if (conflict) {
        this.post({ type: "sessionCompatibility", sessionId, mode: executionMode, conflict });
        release();
        return;
      }
      if (!panelMode && !(await ensureHeadlessConsent())) { release(); return; }
      if (sessionId !== this.sessions.getSessionId() || executionMode !== this.currentExecutionMode()) {
        release();
        this.post({ type: "status", text: "Session or mode changed while preparing. Your draft is ready to send again." });
        return;
      }
      if (vscode.workspace.textDocuments.some((doc) => doc.isDirty && doc.uri.scheme === "file" && isUnderWorkspace(doc.uri.fsPath, workspacePath))) {
        throw new Error("Save your workspace editors before sending so the turn checkpoint includes your latest edits.");
      }
      checkpoint = await this.checkpoints.begin(workspacePath, sessionId, trimmed);
      if (this.disposed || sessionId !== this.sessions.getSessionId() || executionMode !== this.currentExecutionMode()) {
        await this.checkpoints.finish(checkpoint);
        release();
        return;
      }
    } catch (err) {
      release?.();
      this.post({ type: "error", text: `Could not create a safe turn checkpoint: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    let finishing: Promise<void> | undefined;
    const finishCheckpoint = () => finishing ??= (async () => {
      try { await this.checkpoints.finish(checkpoint); }
      catch (err) { this.post({ type: "error", text: `Turn checkpoint could not be finalized; undo is unavailable: ${String(err)}` }); }
      finally { release?.(); }
      if (sessionId === this.sessions.getSessionId()) await this.postTurnReviews();
    })();
    this.finishCheckpoint = finishCheckpoint;

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

    this.sessions.saveRequestContext(sessionId, expanded, attachments);
    this.post({ type: "submitAccepted" });
    this.post({ type: "user", prompt: trimmed, attached: chipLabels, requestContext: attachments });
    this.post({ type: "running", running: true });
    this.setRunning(true);

    let stderr = "";
    const generation = ++this.runGeneration;
    try {
      const start = panelMode ? (options: Parameters<typeof startMuseExec>[0]) => {
        const settings = readMuseSettings();
        const binary = resolveMuseBinary(settings.executablePath);
        if (!binary.ok) throw new Error(binary.error);
        return startMusePanel(options, binary.path, settings, this.approvals, this.questions);
      } : startMuseExec;
      this.run = start({
        windowsShell: executionMode === "windows",
        prompt: expanded,
        workspacePath,
        sessionId,
        onEvent: (event) => {
          if (generation === this.runGeneration) this.handleEvent(event);
        },
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
          if (generation !== this.runGeneration) return;
          stderr = (stderr + text).slice(-16000);
          const line = text.trim();
          if (line && !panelMode) {
            this.post({ type: "stderr", text: line });
          }
        },
        onExit: async (code, signal) => {
          if (generation !== this.runGeneration) return;
          this.checkpointBusy = true;
          await finishCheckpoint();
          this.checkpointBusy = false;
          if (generation !== this.runGeneration) return;
          this.run = undefined;
          this.setRunning(false);
          this.post({ type: "running", running: false });
          if (!providerRetry && !signal && code !== 0 && code !== null &&
              /session[\s\S]*created with provider[\s\S]*refusing to resume with provider/i.test(stderr)) {
            this.sessions.saveTranscript(sessionId, this.liveTranscript);
            this.newSession("Provider changed; retrying in a new session");
            void this.submitPrompt(prompt, attachments, true);
            return;
          }
          // The index gets a title after the first turn.
          this.postSession();
          if (signal === "SIGINT" || signal === "SIGTERM") {
            this.post({ type: "status", text: "Interrupted" });
          } else if (code !== 0 && code !== null) {
            this.post({
              type: "error",
              text: `Muse exited with code ${code}.${stderr.trim() ? ` ${stderr.trim().slice(-4000)}` : ""}`,
            });
          }
          this.sessions.saveTranscript(sessionId, this.liveTranscript);
          void this.refreshSessionCompatibility();
          void (async () => {
            if (code === 0) await this.hydrateTranscript({ paintCacheFirst: false });
            await this.postTurnReviews();
          })();
        },
      });
    } catch (err) {
      await finishCheckpoint();
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
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.terminalOutput.dispose();
    this.status.dispose();
    this.checkpointRegistration.dispose();
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

    const listed = this.listSessionsForCurrentFolder(sessionId);
    const match = Array.isArray(listed) ? listed.find((s) => s.sessionId === sessionId) : undefined;
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

    loaded.items = preserveStoppedTranscript(this.liveTranscript, loaded.items);
    loaded.items = preserveToolMetadata(this.liveTranscript, loaded.items);
    this.liveTranscript = loaded.items;
    this.sessions.saveTranscript(sessionId, loaded.items);
    this.post({
      type: "history",
      items: this.enrichItemsForWebview(loaded.items),
      source: loaded.source,
    });
    await this.postTurnReviews();
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
      case "assistant_begin":
        this.post({ type: "assistant_begin" });
        break;
      case "user":
        // Already posted locally; skip duplicate from stream.
        break;
      case "assistant_delta":
        this.post({ type: "assistant_delta", text: event.text });
        break;
      case "assistant_final": {
        const text = assistantDisplayText(event.text);
        this.post({
          type: "assistant_final",
          text,
          html: this.assistantHtml(text),
          files: this.fileChips(text),
          terminal: event.terminal,
          reason: event.reason ?? null,
        });
        break;
      }
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
          status: event.status,
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
      return { type: "user", text: stripped.display, attached: stripped.attached,
        requestContext: this.sessions.getRequestContext(this.sessions.getSessionId(), item.text) };
    }
    if (item.type === "assistant") {
      const text = assistantDisplayText(item.text);
      return {
        type: "assistant",
        text,
        html: this.assistantHtml(text),
        files: this.fileChips(text),
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
      execMeta: { ...formatted.execMeta, ...item.execMeta },
      status: item.status,
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
    const brandUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "muse-brand.svg"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Muse CLI Chat</title>
</head>
<body>
  <header class="top">
    <div class="top-row">
      <div class="brand">
        <img class="brand-mark" src="${brandUri}" width="30" height="30" alt="" aria-hidden="true" />
        <span class="brand-name">Muse Code</span>
      </div>
      <div class="meta">
        <div id="folder" class="folder"></div>
        <div id="execution-mode" class="execution-mode" title=""></div>
      </div>
      <div class="toolbar" role="toolbar" aria-label="Session">
        <button type="button" id="toolbar-history" class="icon-btn" title="Session history" aria-label="Session history">${ICON_HISTORY}</button>
        <button type="button" id="toolbar-new" class="icon-btn" title="New chat in editor" aria-label="New chat in editor">${ICON_PLUS}</button>
      </div>
    </div>
    <div class="session-row">
      <button type="button" id="session-btn" class="session-btn" title="Resume or start a Muse session">
        <span id="session" class="session">New chat</span>
      </button>
      <div class="session-actions">
        <button type="button" id="session-rename" class="session-action" title="Rename this conversation in this VS Code workspace">Rename</button>
        <button type="button" id="session-fork" class="session-action" title="Branch all completed turns into an independent conversation. Workspace files stay as they are.">Branch</button>
      </div>
      <span id="session-parent" class="session-parent" hidden></span>
    </div>
    <div id="session-action-status" class="session-action-status" role="status" aria-live="polite" hidden></div>
  </header>
  <div id="mode-banner" class="mode-banner" hidden>
    <span id="mode-banner-text" class="mode-banner-text"></span>
    <button type="button" id="mode-banner-dismiss" class="mode-banner-dismiss" title="Dismiss" aria-label="Dismiss">${ICON_CLOSE}</button>
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
  <div class="interactions">
    <aside id="approvals" class="approvals" aria-label="Muse permission requests" aria-live="polite" hidden></aside>
    <aside id="questions" class="questions" aria-label="Questions from Muse" aria-live="polite" hidden></aside>
  </div>
  <button id="latest" class="latest" type="button" hidden aria-label="Scroll to latest message">Latest message ↓</button>
  <section class="welcome" aria-label="Getting started">
    <div class="welcome-mark"><img src="${brandUri}" width="68" height="68" alt="Muse" /></div>
    <h1 class="welcome-title">What are we building?</h1>
    <p class="welcome-description">A question, a fix, your next idea.</p>
    <ul class="welcome-tips">
      <li><kbd>@</kbd> attaches a file with its contents</li>
      <li><strong>Attach</strong> adds Problems, terminal output, or open editors</li>
      <li>Changed files open as diffs after each turn</li>
    </ul>
    <p class="unofficial">
      Unofficial · wraps Meta Muse Code · not affiliated with Meta
      <!-- <button type="button" id="muse-ai" class="muse-ai-link" title="Copy this session and open muse.ai">muse.ai</button> -->
    </p>
  </section>
  <footer class="composer">
    <p id="draft-note" class="draft-note" role="status" aria-live="polite" hidden></p>
    <aside id="session-conflict" class="session-conflict" aria-label="Session mode needs attention" aria-live="polite" hidden>
      <p id="session-conflict-text"></p>
      <div class="session-conflict-actions">
        <button type="button" id="session-conflict-panel" class="secondary">Use Panel approvals</button>
        <button type="button" id="session-conflict-new" class="secondary">Start new session</button>
      </div>
    </aside>
    <div id="attachments" class="attachments" hidden aria-label="Attached context"></div>
    <div id="mentions" class="mentions" hidden role="listbox" aria-label="File mentions"></div>
    <div class="input-box">
      <div class="input-field">
        <div id="input-mirror" class="input-mirror" aria-hidden="true"></div>
        <textarea id="input" rows="2" placeholder="Ask Muse… (@ file, ⌘Enter to send)"></textarea>
      </div>
      <div class="actions">
        <div class="attach-wrap">
          <button type="button" id="attach" class="icon-btn" title="Attach file contents, problems, terminal output, or open editors" aria-label="Attach context">${ICON_ATTACH}</button>
          <div id="attach-menu" class="attach-menu" hidden role="menu">
            <button type="button" data-attach="file" role="menuitem">File… (@)</button>
            <button type="button" data-attach="current" role="menuitem">Current file</button>
            <button type="button" data-attach="editors" role="menuitem">Open editors</button>
            <button type="button" data-attach="problems" role="menuitem">Problems</button>
            <button type="button" data-attach="terminal" role="menuitem">Terminal output</button>
          </div>
        </div>
        <button type="button" id="history" class="history-dup" hidden>History</button>
        <button type="button" id="stop" class="round-btn stop-btn" disabled title="Stop" aria-label="Stop">${ICON_STOP}</button>
        <button type="button" id="send" class="round-btn send-btn" title="Send (⌘Enter)" aria-label="Send">${ICON_SEND}</button>
      </div>
    </div>
    <div class="composer-foot">
      <div class="pills" role="group" aria-label="Run settings">
        <button type="button" id="mode-pill" class="pill" title="Switch execution mode"></button>
        <button type="button" id="model-pill" class="pill" title="Model (opens settings)"></button>
        <button type="button" id="effort-pill" class="pill" title="Reasoning effort (opens settings)"></button>
      </div>
      <span id="focus-hint" class="focus-hint"></span>
    </div>
  </footer>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/* Inline SVG icons (the webview CSP blocks icon fonts). currentColor keeps them themed. */
const svg = (body: string, size = 16): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_HISTORY = svg('<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 2.5v2.2h2.2"/><path d="M8 5v3.2l2 1.3"/>');
const ICON_PLUS = svg('<path d="M8 3v10M3 8h10"/>');
const ICON_CLOSE = svg('<path d="M4 4l8 8M12 4l-8 8"/>', 14);
const ICON_ATTACH = svg('<path d="M10.5 5 5.8 9.7a1.3 1.3 0 0 0 1.9 1.9l5-5a2.6 2.6 0 0 0-3.7-3.7l-5 5a3.9 3.9 0 0 0 5.5 5.5L14 9"/>');
const ICON_SEND = svg('<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>');
const ICON_STOP = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="currentColor"/></svg>';

/**
 * The echo provider repeats the whole expanded prompt, including the
 * <attached-context> block; that block is for the model, not for display.
 */
function assistantDisplayText(text: string): string {
  return stripAttachedContext(text).display;
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
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    const rel = uri.scheme === "file" ? relativeToWorkspace(uri.fsPath, workspacePath) : null;
    if (!rel) {
      continue;
    }
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
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const visible = new Set(
    (vscode.window.visibleTextEditors ?? [])
      .map((e) => e.document.uri.fsPath)
      .filter(Boolean),
  );
  const docs = vscode.workspace.textDocuments.filter(
    (doc) =>
      doc.uri.scheme === "file" &&
      !doc.isUntitled &&
      relativeToWorkspace(doc.uri.fsPath, workspacePath) !== null,
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
      path: relativeToWorkspace(doc.uri.fsPath, workspacePath) ?? doc.uri.fsPath,
      content: truncated ? text.slice(0, MAX_EDITOR_CHARS) : text,
      truncated,
    };
  });
}
