import { formatToolResult } from "./toolResultFormat";
import type { TranscriptItem } from "./transcript";

export const MUSE_AI_URL = "https://muse.ai/";

/** Soft cap so a paste into Muse.ai stays usable. */
export const HANDOFF_MAX_CHARS = 80_000;

export interface HandoffMeta {
  sessionId?: string;
  workspaceName?: string;
}

export function selectHandoffTranscript(opts: {
  liveItems: TranscriptItem[];
  exportedItems: TranscriptItem[];
  running: boolean;
}): TranscriptItem[] {
  if (opts.running && opts.liveItems.length > 0) {
    return opts.liveItems;
  }
  if (opts.exportedItems.length > 0) {
    return opts.exportedItems;
  }
  return opts.liveItems;
}

export function transcriptToMarkdown(
  items: TranscriptItem[],
  meta: HandoffMeta = {},
): string {
  const body = items
    .map(itemToMarkdown)
    .filter((block): block is string => Boolean(block));
  if (body.length === 0) {
    return "";
  }

  const header = [
    "# Muse Code session",
    "",
    "Paste this into muse.ai to continue from a Muse Code sidebar session.",
    "",
    ...metaLines(meta),
  ];

  let markdown = [...header, ...body].join("\n").trimEnd() + "\n";
  if (markdown.length > HANDOFF_MAX_CHARS) {
    markdown =
      markdown.slice(0, HANDOFF_MAX_CHARS).trimEnd() +
      "\n\n…(truncated)\n";
  }
  return markdown;
}

function metaLines(meta: HandoffMeta): string[] {
  const lines: string[] = [];
  if (meta.sessionId) {
    lines.push(`- Session: \`${meta.sessionId}\``);
  }
  if (meta.workspaceName) {
    lines.push(`- Workspace: ${meta.workspaceName}`);
  }
  if (lines.length > 0) {
    lines.push("");
  }
  return lines;
}

function itemToMarkdown(item: TranscriptItem): string | null {
  switch (item.type) {
    case "user": {
      const text = item.text.trim();
      return text ? `## User\n\n${text}\n` : null;
    }
    case "assistant": {
      const text = item.text.trim();
      return text ? `## Muse\n\n${text}\n` : null;
    }
    case "tool": {
      const raw = (item.resultRaw ?? item.text ?? "").trim();
      if (!raw) {
        return null;
      }
      const formatted = formatToolResult(raw);
      const output = (formatted.resultView ?? formatted.resultRaw).trim();
      const name = item.name.trim() || "tool";
      return `## Tool \`${name}\`\n\n\`\`\`\n${output}\n\`\`\`\n`;
    }
    default:
      return null;
  }
}
