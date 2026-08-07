import { randomUUID } from "node:crypto";
import * as vscode from "vscode";

const SESSION_KEY = "muse.sessionId";

export class SessionStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getSessionId(): string {
    const existing = this.context.workspaceState.get<string>(SESSION_KEY);
    if (existing) {
      return existing;
    }
    return this.newSession();
  }

  newSession(): string {
    const id = randomUUID();
    void this.context.workspaceState.update(SESSION_KEY, id);
    return id;
  }
}
