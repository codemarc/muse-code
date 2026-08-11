import { readFileSync } from "node:fs";
import {
  truncateText,
  trimTranscript,
  type TranscriptItem,
} from "./transcript";

interface RuntimeSessionPayload {
  kind?: string;
  run_id?: string;
  event?: {
    kind?: string;
    prompt?: string;
    text?: string;
    results?: Array<{ text?: string; tool_call_id?: string }>;
    tool_calls?: Array<{ name?: string; call_id?: string }>;
  };
}

export interface SessionEnvelope {
  payload_type?: string;
  payload?: RuntimeSessionPayload & Record<string, unknown>;
}

interface ExportEvent {
  kind?: string;
  envelope?: SessionEnvelope;
}

interface ExportDocument {
  events?: ExportEvent[];
}

/**
 * Build a sidebar transcript from Muse export events / session.jsonl envelopes.
 * Durable logs nest conversation under `runtime.session` (live JSONL types are often omitted).
 */
export function transcriptFromSessionEnvelopes(
  envelopes: SessionEnvelope[],
): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const seenRunPrompts = new Set<string>();

  for (const env of envelopes) {
    if (env.payload_type !== "runtime.session") {
      continue;
    }
    const payload = env.payload;
    if (!payload || payload.kind !== "run") {
      continue;
    }
    const event = payload.event;
    if (!event?.kind) {
      continue;
    }

    if (event.kind === "started" && typeof event.prompt === "string") {
      const prompt = event.prompt.trim();
      if (!prompt) {
        continue;
      }
      // Nested/replayed starts under the same run can repeat the prompt.
      const runKey = `${payload.run_id ?? ""}:${prompt}`;
      if (seenRunPrompts.has(runKey)) {
        continue;
      }
      seenRunPrompts.add(runKey);
      items.push({ type: "user", text: prompt });
      continue;
    }

    if (event.kind === "assistant_message_committed" && typeof event.text === "string") {
      const text = event.text.trim();
      if (text) {
        items.push({ type: "assistant", text });
      }
      continue;
    }

    if (event.kind === "tool_result_batch_committed" && Array.isArray(event.results)) {
      for (const result of event.results) {
        const raw = String(result.text ?? "").trim();
        if (!raw) {
          continue;
        }
        items.push({
          type: "tool",
          name: result.tool_call_id?.slice(0, 12) || "tool",
          resultRaw: truncateText(raw, 32000),
        });
      }
    }
  }

  return trimTranscript(items);
}

export function envelopesFromSessionJsonl(raw: string): SessionEnvelope[] {
  const out: SessionEnvelope[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const record = JSON.parse(trimmed) as SessionEnvelope;
      if (record && typeof record === "object") {
        out.push(record);
      }
    } catch {
      // skip bad lines
    }
  }
  return out;
}

export function envelopesFromExportDocument(doc: ExportDocument): SessionEnvelope[] {
  const out: SessionEnvelope[] = [];
  for (const event of doc.events ?? []) {
    if (event.kind === "record" && event.envelope) {
      out.push(event.envelope);
    }
  }
  return out;
}

export function transcriptFromSessionJsonl(raw: string): TranscriptItem[] {
  return transcriptFromSessionEnvelopes(envelopesFromSessionJsonl(raw));
}

export function transcriptFromExportJson(raw: string): TranscriptItem[] {
  const doc = JSON.parse(raw) as ExportDocument;
  return transcriptFromSessionEnvelopes(envelopesFromExportDocument(doc));
}

export function transcriptFromSessionLogPath(sessionLogPath: string): TranscriptItem[] {
  const raw = readFileSync(sessionLogPath, "utf8");
  return transcriptFromSessionJsonl(raw);
}
