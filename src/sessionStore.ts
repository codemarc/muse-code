import { createUuidV7Mint } from "@muse-code/sdk";
import * as vscode from "vscode";
import { createHash } from "node:crypto";
import type { AttachmentRequest } from "./contextAttachments";
import { trimTranscript, type TranscriptItem } from "./transcript";

const SESSION_KEY = "muse.sessionId";
const TRANSCRIPT_KEY = "muse.transcriptCache";
const mintSessionId = createUuidV7Mint();

interface TranscriptCache {
  sessionId: string;
  items: TranscriptItem[];
  updatedAt: number;
}

export class SessionStore {
  private readonly sessionKey: string;
  private readonly transcriptKey: string;
  private readonly requestContextKey: string;
  constructor(private readonly context: vscode.ExtensionContext, namespace?: string) {
    this.sessionKey = namespace ? `${SESSION_KEY}.${namespace}` : SESSION_KEY;
    this.transcriptKey = namespace ? `${TRANSCRIPT_KEY}.${namespace}` : TRANSCRIPT_KEY;
    this.requestContextKey = namespace ? `muse.requestContext.${namespace}` : "muse.requestContext";
  }

  getSessionId(): string {
    const existing = this.context.workspaceState.get<string>(this.sessionKey);
    if (existing) {
      return existing;
    }
    return this.newSession();
  }

  setSessionId(id: string): void {
    void this.context.workspaceState.update(this.sessionKey, id);
  }

  newSession(): string {
    const id = mintSessionId();
    void this.context.workspaceState.update(this.sessionKey, id);
    void this.context.workspaceState.update(this.transcriptKey, {
      sessionId: id,
      items: [],
      updatedAt: Date.now(),
    } satisfies TranscriptCache);
    return id;
  }

  getCachedTranscript(sessionId?: string): TranscriptItem[] {
    const cache = this.context.workspaceState.get<TranscriptCache>(this.transcriptKey);
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
    void this.context.workspaceState.update(this.transcriptKey, {
      sessionId,
      items: trimTranscript(items),
      updatedAt: Date.now(),
    } satisfies TranscriptCache);
  }

  /** Extension-owned names and branch provenance, shared by editor chats. */
  getLabels(root: string): Record<string, { name: string; parent?: string }> {
    return this.context.workspaceState.get(this.labelKey(root)) ?? {};
  }

  async saveLabel(root: string, id: string, name: string, parent?: string): Promise<void> {
    const labels = this.getLabels(root);
    await this.context.workspaceState.update(this.labelKey(root), {
      ...labels, [id]: { ...labels[id], name, ...(parent ? { parent } : {}) },
    });
  }

  private labelKey(root: string): string {
    const path = root.replace(/[\\/]+$/, "");
    return `muse.sessionLabels.${process.platform === "win32" ? path.toLowerCase() : path}`;
  }

  /** Keep only explicit request descriptors, never infer file requests from log text. */
  saveRequestContext(sessionId: string, expandedPrompt: string, attachments: AttachmentRequest[]): void {
    const key = this.requestKey(sessionId, expandedPrompt);
    const previous = this.context.workspaceState.get<Record<string, AttachmentRequest[]>>(this.requestContextKey) ?? {};
    const entries = Object.entries(previous).filter(([id]) => id !== key).slice(-63);
    entries.push([key, attachments.slice(0, 16).map((item) => ({ ...item }))]);
    void this.context.workspaceState.update(this.requestContextKey, Object.fromEntries(entries));
  }

  getRequestContext(sessionId: string, expandedPrompt: string): AttachmentRequest[] | undefined {
    const context = this.context.workspaceState.get<Record<string, AttachmentRequest[]>>(this.requestContextKey);
    const value = context?.[this.requestKey(sessionId, expandedPrompt)];
    return Array.isArray(value) ? value.slice(0, 16).map((item) => ({ ...item })) : undefined;
  }

  private requestKey(sessionId: string, prompt: string): string {
    return `${sessionId}:${createHash("sha256").update(prompt).digest("hex")}`;
  }
}
