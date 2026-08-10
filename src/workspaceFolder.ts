import * as vscode from "vscode";
import { matchStoredFolder } from "./workspaceFolderMatch";

const FOLDER_KEY = "muse.workspaceFolderUri";

export interface FolderChoice {
  uri: vscode.Uri;
  name: string;
  fsPath: string;
}

function toChoice(folder: vscode.WorkspaceFolder): FolderChoice {
  return {
    uri: folder.uri,
    name: folder.name,
    fsPath: folder.uri.fsPath,
  };
}

export class WorkspaceFolderStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Current selection if valid; single-root auto-selects; multi-root may be unset. */
  getFolder(): FolderChoice | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const stored = this.context.workspaceState.get<string>(FOLDER_KEY);
    const match = matchStoredFolder(
      folders.map((f) => ({
        name: f.name,
        fsPath: f.uri.fsPath,
        uriString: f.uri.toString(),
      })),
      stored,
    );
    if (!match) {
      return undefined;
    }
    const folder = folders.find((f) => f.uri.toString() === match.uriString);
    return folder ? toChoice(folder) : undefined;
  }

  /**
   * Resolve a folder for Muse runs.
   * Multi-root with no/invalid selection opens a Quick Pick.
   */
  async resolveFolder(opts?: { forcePick?: boolean }): Promise<FolderChoice | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return undefined;
    }
    if (folders.length === 1) {
      const choice = toChoice(folders[0]!);
      await this.persist(choice.uri);
      return choice;
    }

    const current = opts?.forcePick ? undefined : this.getFolder();
    if (current) {
      return current;
    }

    const picked = await vscode.window.showQuickPick(
      folders.map((f) => ({
        label: f.name,
        description: f.uri.fsPath,
        folder: f,
      })),
      {
        title: "Muse CLI Chat: choose workspace folder",
        placeHolder: "Muse runs against one folder root",
        ignoreFocusOut: true,
      },
    );
    if (!picked) {
      return undefined;
    }
    const choice = toChoice(picked.folder);
    await this.persist(choice.uri);
    return choice;
  }

  async clear(): Promise<void> {
    await this.context.workspaceState.update(FOLDER_KEY, undefined);
  }

  private async persist(uri: vscode.Uri): Promise<void> {
    await this.context.workspaceState.update(FOLDER_KEY, uri.toString());
  }
}
