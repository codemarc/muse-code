import * as vscode from "vscode";
import { probeMuseAuth } from "./museAuth";
import {
  checkMuseInstallation,
  resolveMuseBinary,
  readMuseSettings,
  startMuseExec,
  type MuseRunHandle,
} from "./museCli";
import type { MuseUiEvent } from "./museJsonl";
import { isSupportedPlatform, unsupportedPlatformMessage } from "./platform";
import { ensureHeadlessConsent } from "./safety";
import type { SessionStore } from "./sessionStore";
import { inspectWorkspaceRoot } from "./workspace";
import type { WorkspaceFolderStore } from "./workspaceFolder";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "muse.chatView";

  private view?: vscode.WebviewView;
  private run?: MuseRunHandle;
  private readonly status: vscode.StatusBarItem;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionStore,
    private readonly folders: WorkspaceFolderStore,
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
          await this.refreshSetup();
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
      }
    });
  }

  reveal(): void {
    void vscode.commands.executeCommand("muse.chatView.focus");
  }

  newSession(): void {
    this.stop();
    const id = this.sessions.newSession();
    this.post({ type: "session", sessionId: id });
    this.post({ type: "cleared" });
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
          terminal: event.terminal,
          reason: event.reason ?? null,
        });
        break;
      case "status":
        this.post({ type: "status", text: event.text });
        break;
      case "tool":
        this.post({ type: "tool", name: event.name, result: event.result });
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
      <div id="session" class="session"></div>
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
      <button type="button" id="stop" class="secondary" disabled>Stop</button>
      <button type="button" id="send" class="primary">Send</button>
    </div>
    <p class="hint">First send may ask to enable disable-approval (sandbox stays on). Use the terminal command for interactive approvals. Not affiliated with Meta.</p>
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
