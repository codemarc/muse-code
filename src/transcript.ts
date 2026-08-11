/** Compact sidebar transcript items (UI + workspaceState cache). */

export type TranscriptItem =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; resultRaw?: string; text?: string }
  | { type: "status"; text: string }
  | { type: "task"; text: string }
  | { type: "error"; text: string };

const MAX_TOOL_CHARS = 2000;
const MAX_TOOL_CACHE_CHARS = 32000;
const MAX_ITEMS = 400;

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
          if (!last.text) {
            last.text = text;
          }
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
