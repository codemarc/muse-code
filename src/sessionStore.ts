import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { trimTranscript, type TranscriptItem } from "./transcript";

const SESSION_KEY = "muse.sessionId";
const TRANSCRIPT_KEY = "muse.transcriptCache";

interface TranscriptCache {
  sessionId: string;
  items: TranscriptItem[];
  updatedAt: number;
}

export class SessionStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getSessionId(): string {
    const existing = this.context.workspaceState.get<string>(SESSION_KEY);
    if (existing) {
      return existing;
    }
    return this.newSession();
  }

  setSessionId(id: string): void {
    void this.context.workspaceState.update(SESSION_KEY, id);
  }

  newSession(): string {
    const id = randomUUID();
    void this.context.workspaceState.update(SESSION_KEY, id);
    void this.context.workspaceState.update(TRANSCRIPT_KEY, {
      sessionId: id,
      items: [],
      updatedAt: Date.now(),
    } satisfies TranscriptCache);
    return id;
  }

  getCachedTranscript(sessionId?: string): TranscriptItem[] {
    const cache = this.context.workspaceState.get<TranscriptCache>(TRANSCRIPT_KEY);
    if (!cache) {
      return [];
    }
    const id = sessionId ?? this.getSessionId();
    if (cache.sessionId !== id) {
      return [];
    }
    return Array.isArray(cache.items) ? cache.items : [];
  }

  saveTranscript(sessionId: string, items: TranscriptItem[]): void {
    void this.context.workspaceState.update(TRANSCRIPT_KEY, {
      sessionId,
      items: trimTranscript(items),
      updatedAt: Date.now(),
    } satisfies TranscriptCache);
  }
}
