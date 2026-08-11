import { formatToolResult, type ExecMeta } from "./toolResultFormat";

/** Muse Code JSONL envelope from `muse exec --json`. */

export interface MuseStreamRef {
  kind: string;
  id: string;
}

export interface MuseRecord {
  schema_version: number;
  id: string;
  stream: MuseStreamRef;
  sequence: number;
  recorded_at: number;
  record_type: string;
  durability: string;
  causation_id?: string;
  payload_type: string;
  payload_schema_version: number;
  payload: Record<string, unknown>;
}

/** Normalized UI events emitted by the parser. */
export type MuseUiEvent =
  | { kind: "user"; prompt: string; sessionId?: string }
  | { kind: "assistant_delta"; text: string }
  | { kind: "assistant_final"; text: string; terminal: string; reason?: string | null }
  | { kind: "status"; text: string }
  | {
      kind: "tool";
      name: string;
      resultRaw: string;
      resultView: string | null;
      execMeta?: ExecMeta;
    }
  | { kind: "task"; text: string }
  | { kind: "unknown"; payloadType: string; payload: Record<string, unknown> }
  | { kind: "parse_error"; line: string; error: string };

export function parseMuseLine(line: string): MuseRecord | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const record = JSON.parse(trimmed) as MuseRecord;
  if (!record || typeof record.payload_type !== "string") {
    throw new Error("missing payload_type");
  }
  return record;
}

export function recordToUiEvent(record: MuseRecord): MuseUiEvent | null {
  const { payload_type: type, payload, stream } = record;
  const sessionId = stream?.kind === "session" ? stream.id : undefined;

  switch (type) {
    case "turn.input.user": {
      const prompt = String(payload.prompt ?? "");
      return { kind: "user", prompt, sessionId };
    }
    case "run.output.delta": {
      const text = String(payload.text ?? "");
      if (!text) {
        return null;
      }
      return { kind: "assistant_delta", text };
    }
    case "run.lifecycle.started":
    case "run.started":
      return { kind: "status", text: "Run started" };
    case "run.model.configured": {
      const model = payload.model ?? payload.model_id ?? "model";
      return { kind: "status", text: `Model: ${String(model)}` };
    }
    case "run.terminal.completed":
    case "run.terminal.failed":
    case "run.terminal.cancelled":
    case "run.terminal": {
      const terminal = String(payload.terminal ?? type.split(".").pop() ?? "completed");
      const text = payload.text != null ? String(payload.text) : "";
      const reason = (payload.reason as string | null | undefined) ?? null;
      return { kind: "assistant_final", text, terminal, reason };
    }
    case "tool.result": {
      const name = String(
        payload.tool_name ?? payload.name ?? payload.tool ?? "tool",
      );
      const rawValue = payload.result ?? payload.output ?? payload;
      const formatted = formatToolResult(rawValue);
      return { kind: "tool", name, ...formatted };
    }
    case "runtime.command.accepted":
    case "session.run.linked":
    case "task.stream.linked":
      return null;
    default: {
      if (type.startsWith("task.")) {
        const eventKind =
          (payload.event as { kind?: string } | undefined)?.kind ??
          type.replace(/^task\./, "");
        // Skip high-volume lifecycle noise; keep meaningful milestones.
        const keep = new Set([
          "failed",
          "cancelled",
          "completed",
        ]);
        if (!keep.has(String(eventKind)) && type !== "task.lifecycle.failed") {
          return null;
        }
        const taskKind =
          (payload.event as { task_kind?: string } | undefined)?.task_kind ??
          "";
        const taskId = String(payload.task_id ?? "").slice(0, 8);
        const label = taskKind || eventKind;
        return {
          kind: "task",
          text: taskId ? `${label} (${taskId})` : String(label),
        };
      }
      return { kind: "unknown", payloadType: type, payload };
    }
  }
}

/** Incremental JSONL line buffer for stdout chunks. */
export class JsonlLineBuffer {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.trim()) {
        lines.push(line);
      }
    }
    return lines;
  }

  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest || null;
  }
}

export function processJsonlChunk(
  buffer: JsonlLineBuffer,
  chunk: string,
): MuseUiEvent[] {
  const events: MuseUiEvent[] = [];
  for (const line of buffer.push(chunk)) {
    try {
      const record = parseMuseLine(line);
      if (!record) {
        continue;
      }
      const ui = recordToUiEvent(record);
      if (ui) {
        events.push(ui);
      }
    } catch (err) {
      events.push({
        kind: "parse_error",
        line,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return events;
}
