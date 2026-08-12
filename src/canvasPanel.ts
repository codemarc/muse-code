import * as vscode from "vscode";
import { openToolLink } from "./openLink";
import {
  buildPreviewFromPayload,
  type BuiltPreview,
} from "./previewContent";
import type { ExecMeta } from "./toolResultFormat";
import type { WorkspaceFolderStore } from "./workspaceFolder";

export interface CanvasPayload {
  name?: string;
  resultRaw?: string;
  resultView?: string | null;
  execMeta?: ExecMeta;
}

export class CanvasPanel implements vscode.Disposable {
  public static readonly viewType = "muse.canvasPanel";

  private panel?: vscode.WebviewPanel;
  private currentData?: CanvasPayload;
  private currentPreview?: BuiltPreview;
  private toolOutputFormat: "readable" | "json" = "readable";
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly folders: WorkspaceFolderStore,
  ) {
    const cfg = vscode.workspace.getConfiguration("muse");
    this.toolOutputFormat = cfg.get<"readable" | "json">(
      "toolOutputFormat",
      "readable",
    );
  }

  show(data: CanvasPayload): void {
    this.currentData = data;
    this.currentPreview = buildPreviewFromPayload(data);
    const title = panelTitle(data);

    if (this.panel) {
      this.panel.title = title;
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      this.postCanvasData();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CanvasPanel.viewType,
      title,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
      },
    );
    this.panel = panel;
    panel.webview.html = this.getHtml(panel.webview);

    panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg?.type) {
          case "ready":
            this.postCanvasData();
            break;
          case "openLink":
            await this.handleOpenLink(String(msg.href ?? ""));
            break;
          case "openExternally":
            await this.handleOpenExternally();
            break;
          case "copyText": {
            const text = String(msg.text ?? "");
            if (text) {
              await vscode.env.clipboard.writeText(text);
            }
            break;
          }
          case "copyFailed":
            void vscode.window.showWarningMessage(
              "Could not copy tool output to the clipboard.",
            );
            break;
          case "previewFailed":
            void vscode.window.showWarningMessage(
              "Could not render Preview in canvas; showing text instead.",
            );
            break;
        }
      },
      undefined,
      this.disposables,
    );

    panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables,
    );
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    if (this.currentData) {
      this.show(this.currentData);
      return;
    }
    void vscode.window.showInformationMessage(
      "No tool result to show. Open one from a tool card in Muse chat.",
    );
  }

  postConfig(format?: "readable" | "json"): void {
    if (format === "readable" || format === "json") {
      this.toolOutputFormat = format;
    } else {
      const cfg = vscode.workspace.getConfiguration("muse");
      this.toolOutputFormat = cfg.get<"readable" | "json">(
        "toolOutputFormat",
        "readable",
      );
    }
    if (!this.panel) {
      return;
    }
    void this.panel.webview.postMessage({
      type: "config",
      toolOutputFormat: this.toolOutputFormat,
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private postCanvasData(): void {
    if (!this.panel || !this.currentData) {
      return;
    }
    const preview =
      this.currentPreview ?? buildPreviewFromPayload(this.currentData);
    this.currentPreview = preview;
    void this.panel.webview.postMessage({
      type: "canvasData",
      name: this.currentData.name,
      resultRaw: this.currentData.resultRaw ?? "",
      resultView: this.currentData.resultView ?? null,
      execMeta: this.currentData.execMeta,
      toolOutputFormat: this.toolOutputFormat,
      previewKind: preview.kind,
      previewHtml: preview.previewHtml,
      previewBody: preview.body,
      openExternallyHref: preview.openExternallyHref,
    });
  }

  private async handleOpenLink(href: string): Promise<void> {
    const folder = this.folders.getFolder();
    const ok = await openToolLink(href, folder?.uri);
    if (!ok) {
      void vscode.window.showWarningMessage(`Could not open link: ${href}`);
    }
  }

  private async handleOpenExternally(): Promise<void> {
    const href = this.currentPreview?.openExternallyHref;
    if (!href) {
      void vscode.window.showInformationMessage(
        "No HTML/Markdown path found in this tool result to open externally.",
      );
      return;
    }
    await this.handleOpenLink(href);
  }

  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "canvas.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "canvas.js"),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; frame-src 'self' data: blob:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Muse Canvas</title>
</head>
<body>
  <header class="canvas-top">
    <div class="tool-header">
      <span id="label" class="label">Tool result</span>
      <span id="exit" class="tool-exit" hidden></span>
      <div class="tool-actions">
        <button type="button" id="readable" class="tool-toggle">Readable</button>
        <button type="button" id="raw" class="tool-toggle">Raw</button>
        <button type="button" id="preview" class="tool-toggle" hidden>Preview</button>
        <button type="button" id="open-ext" class="tool-toggle" hidden>Open externally</button>
        <button type="button" id="copy" class="tool-toggle">Copy</button>
      </div>
    </div>
  </header>
  <pre id="body" class="tool-body canvas-body"></pre>
  <iframe id="preview-frame" class="canvas-preview" sandbox="allow-popups allow-popups-to-escape-sandbox" hidden title="Preview"></iframe>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function panelTitle(data: CanvasPayload): string {
  const meta = data.execMeta;
  if (meta?.description) {
    return truncate(meta.description, 60);
  }
  if (meta?.command) {
    return truncate(`$ ${meta.command}`, 60);
  }
  if (data.name) {
    return `tool: ${data.name}`;
  }
  return "Muse Canvas";
}

function truncate(s: string, n: number): string {
  if (s.length <= n) {
    return s;
  }
  return `${s.slice(0, n)}…`;
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
