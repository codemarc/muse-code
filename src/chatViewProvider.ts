import * as vscode from "vscode";
import {
  checkMuseInstallation,
  resolveMuseBinary,
  readMuseSettings,
  startMuseExec,
  type MuseRunHandle,
} from "./museCli";
import type { MuseUiEvent } from "./museJsonl";
import { isSupportedPlatform, unsupportedPlatformMessage } from "./platform";
import type { SessionStore } from "./sessionStore";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "muse.chatView";

  private view?: vscode.WebviewView;
  private run?: MuseRunHandle;
  private readonly status: vscode.StatusBarItem;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionStore,
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
    const setup = await this.probeSetup();
    this.post({ type: "setup", ...setup });
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

    const setup = await this.probeSetup();
    this.post({ type: "setup", ...setup });
    if (!setup.ok) {
      void vscode.window.showErrorMessage(setup.message);
      return;
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showErrorMessage("Open a folder to run Muse Code.");
      return;
    }

    // Muse refuses symlink / reparse-point workspace roots.
    const workspacePath = folder.uri.fsPath;
    const sessionId = this.sessions.getSessionId();

    this.post({ type: "user", prompt: trimmed });
    this.post({ type: "running", running: true });
    this.setRunning(true, sessionId);

    this.run = startMuseExec({
      prompt: trimmed,
      workspacePath,
      sessionId,
      onEvent: (event) => this.handleEvent(event),
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
    const folder = vscode.workspace.workspaceFolders?.[0];
    const settings = readMuseSettings();
    const bin = resolveMuseBinary(settings.executablePath);
    const terminal = vscode.window.createTerminal({
      name: "Muse Code",
      cwd: folder?.uri.fsPath,
    });
    terminal.show();
    const cmd = bin.includes(" ") ? `"${bin}"` : bin;
    terminal.sendText(cmd);
  }

  async checkInstallation(): Promise<void> {
    const setup = await this.probeSetup();
    this.post({ type: "setup", ...setup });
    if (setup.ok) {
      void vscode.window.showInformationMessage(`Muse found: ${setup.version}`);
    } else {
      void vscode.window.showErrorMessage(setup.message);
    }
  }

  dispose(): void {
    this.stop();
    this.status.dispose();
  }

  private async probeSetup(): Promise<{
    ok: boolean;
    version?: string;
    message: string;
    installHint: string;
    platformOk: boolean;
  }> {
    const installHint =
      "curl -fsSL https://dev.meta.ai/install.sh | sh";

    if (!isSupportedPlatform()) {
      return {
        ok: false,
        message: unsupportedPlatformMessage(),
        installHint,
        platformOk: false,
      };
    }

    try {
      const version = await checkMuseInstallation();
      return {
        ok: true,
        version,
        message: `Muse ready (${version})`,
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
    <div id="session" class="session"></div>
  </header>
  <div id="setup" class="setup" hidden>
    <p id="setup-msg" class="setup-msg"></p>
    <pre id="setup-install" class="setup-install"></pre>
    <div class="setup-actions">
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
    <p class="hint">Headless runs use sandbox + disable-approval by default. Use the terminal command for interactive approvals. Not affiliated with Meta.</p>
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
