/** Compact sidebar transcript items (UI + workspaceState cache). */
import type { ExecMeta } from "./toolResultFormat";

export type TranscriptItem =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; resultRaw?: string; text?: string; callId?: string; status?: string; execMeta?: ExecMeta }
  | { type: "status"; text: string }
  | { type: "task"; text: string }
  | { type: "error"; text: string };

const MAX_TOOL_CHARS = 2000;
const MAX_TOOL_CACHE_CHARS = 32000;
const MAX_ITEMS = 400;

/** A killed process may not flush its final assistant segment to the Muse log. */
export function preserveStoppedTranscript(cached: TranscriptItem[], loaded: TranscriptItem[]): TranscriptItem[] {
  const last = cached.at(-1);
  if (last?.type !== "status" || last.text !== "Stopped") return loaded;
  const lastUser = cached.map((item) => item.type).lastIndexOf("user");
  const loadedUser = loaded.map((item) => item.type).lastIndexOf("user");
  const prompts = (items: TranscriptItem[]) => items.filter((item) => item.type === "user").map((item) => item.text);
  if (lastUser < 0 || loadedUser < 0 || JSON.stringify(prompts(cached)) !== JSON.stringify(prompts(loaded))) return loaded;
  const cachedText = cached.slice(lastUser + 1).filter((item) => item.type === "assistant").map((item) => item.text).join("");
  const loadedText = loaded.slice(loadedUser + 1).filter((item) => item.type === "assistant").map((item) => item.text).join("");
  return cachedText.length > loadedText.length && cachedText.startsWith(loadedText) ? cached : loaded;
}

export function truncateText(text: string, max = MAX_TOOL_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}

/** Cap transcript size for webview + workspaceState. */
export function trimTranscript(items: TranscriptItem[]): TranscriptItem[] {
  if (items.length <= MAX_ITEMS) {
    return items;
  }
  return items.slice(items.length - MAX_ITEMS);
}

/**
 * Collapse live MuseUiEvent stream into durable-looking transcript items
 * (for the local cache between export hydrations).
 */
export function appendLiveUiEvent(
  items: TranscriptItem[],
  event: {
    kind: string;
    prompt?: string;
    text?: string;
    name?: string;
    callId?: string;
    status?: string;
    execMeta?: ExecMeta;
    result?: string;
    resultRaw?: string;
    error?: string;
    line?: string;
    terminal?: string;
    reason?: string | null;
  },
): TranscriptItem[] {
  const next = items.slice();
  switch (event.kind) {
    case "assistant_begin":
      next.push({ type: "assistant", text: "" });
      break;
    case "user":
      next.push({ type: "user", text: event.prompt ?? "" });
      break;
    case "assistant_delta": {
      const text = event.text ?? "";
      if (!text) {
        break;
      }
      const last = next[next.length - 1];
      if (last?.type === "assistant") {
        last.text += text;
      } else {
        next.push({ type: "assistant", text });
      }
      break;
    }
    case "assistant_final": {
      const text = event.text ?? "";
      const last = next[next.length - 1];
      if (text) {
        if (last?.type === "assistant") {
          last.text = text;
        } else {
          next.push({ type: "assistant", text });
        }
      }
      if (event.terminal && event.terminal !== "completed") {
        next.push({
          type: "status",
          text: `terminal: ${event.terminal}${event.reason ? `: ${event.reason}` : ""}`,
        });
      }
      break;
    }
    case "tool":
      next.push({
        type: "tool",
        name: event.name || "tool",
        ...(event.callId ? { callId: event.callId } : {}),
        ...(event.status ? { status: event.status } : {}),
        ...(event.execMeta ? { execMeta: event.execMeta } : {}),
        resultRaw: truncateText(
          event.resultRaw ?? event.result ?? "",
          MAX_TOOL_CACHE_CHARS,
        ),
      });
      break;
    case "task":
      next.push({ type: "task", text: event.text ?? "" });
      break;
    case "status":
      // Skip noisy live status for the cache; hydrate fills meaningful ones.
      break;
    case "parse_error":
      next.push({ type: "error", text: event.error || event.line || "parse error" });
      break;
    default:
      break;
  }
  return trimTranscript(next);
}

/** Preserve SDK outcome facts by stable tool call id when loading durable history. */
export function preserveToolMetadata(cached: TranscriptItem[], loaded: TranscriptItem[]): TranscriptItem[] {
  const tools = new Map<string, Extract<TranscriptItem, { type: "tool" }>>();
  const ambiguous = new Set<string>();
  for (const item of cached) if (item.type === "tool" && item.callId) {
    if (tools.has(item.callId)) ambiguous.add(item.callId);
    tools.set(item.callId, item);
  }
  const loadedIds = new Set<string>();
  for (const item of loaded) if (item.type === "tool" && item.callId) {
    if (loadedIds.has(item.callId)) ambiguous.add(item.callId);
    loadedIds.add(item.callId);
  }
  return loaded.map((item) => {
    if (item.type !== "tool" || !item.callId || ambiguous.has(item.callId)) return item;
    const previous = tools.get(item.callId);
    if (previous?.type !== "tool") return item;
    return { ...item, name: previous.name, ...(previous.status ? { status: previous.status } : {}), ...(previous.execMeta ? { execMeta: previous.execMeta } : {}) };
  });
}
