/** Format muse exec tool results for readable sidebar display. */

export interface ExecMeta {
  exitCode?: number;
  description?: string;
  command?: string;
  truncated?: boolean;
}

export interface FormattedToolResult {
  resultRaw: string;
  resultView: string | null;
  execMeta?: ExecMeta;
}

export function isExecEnvelope(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return false;
  }
  const o = obj as Record<string, unknown>;
  return typeof o.command === "string" && typeof o.output === "string";
}

export function formatExecEnvelope(obj: Record<string, unknown>): string {
  const command = String(obj.command ?? "");
  const description = obj.description ? String(obj.description) : "";
  const exitCode = obj.exit_code;
  const output = String(obj.output ?? "");
  const truncated = Boolean(obj.truncated);

  const lines: string[] = [];
  if (command) {
    const descSuffix = description ? `  # ${description}` : "";
    lines.push(`$ ${command}${descSuffix}`);
  } else if (description) {
    lines.push(description);
  }
  if (exitCode !== undefined && exitCode !== null) {
    lines.push(`exit ${exitCode}`);
  }
  const terminalStatus = obj.terminal_status;
  if (
    terminalStatus &&
    terminalStatus !== "completed" &&
    typeof terminalStatus === "string"
  ) {
    lines.push(`status: ${terminalStatus}`);
  }
  if (output) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(output);
  }
  if (truncated) {
    lines.push("");
    lines.push("(output truncated)");
  }
  return lines.join("\n");
}

export function execMetaFromEnvelope(obj: Record<string, unknown>): ExecMeta {
  return {
    exitCode: typeof obj.exit_code === "number" ? obj.exit_code : undefined,
    description: obj.description ? String(obj.description) : undefined,
    command: obj.command ? String(obj.command) : undefined,
    truncated: Boolean(obj.truncated),
  };
}

export function formatToolResult(value: unknown): FormattedToolResult {
  let parsed: unknown = value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return { resultRaw: value, resultView: null };
      }
    } else {
      return { resultRaw: value, resultView: null };
    }
  }

  const resultRaw =
    typeof value === "string" ? value : stringifyPayload(parsed);

  if (isExecEnvelope(parsed)) {
    return {
      resultRaw,
      resultView: formatExecEnvelope(parsed),
      execMeta: execMetaFromEnvelope(parsed),
    };
  }

  return { resultRaw, resultView: null };
}

function stringifyPayload(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
