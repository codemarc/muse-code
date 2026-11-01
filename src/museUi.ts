/** Pure UI helpers for the Muse editor tab, pills, banner, and status bar. */

export function shortSessionId(sessionId: string): string {
  return sessionId ? sessionId.slice(0, 8) : "————";
}

export function formatModelPill(model: string): string {
  const trimmed = model.trim();
  return trimmed ? trimmed : "auto";
}

export function formatEffortPill(effort: string): string {
  const trimmed = effort.trim().toLowerCase();
  if (!trimmed) {
    return "default";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function buildMuseStatusText(opts: {
  running: boolean;
  modeLabel: string;
  sessionId: string;
}): string {
  const short = shortSessionId(opts.sessionId);
  const mode = opts.modeLabel.trim() || "Headless";
  if (opts.running) {
    return `$(sync~spin) Muse ${short} · ${mode}`;
  }
  return `✨ Muse ${short} · ${mode}`;
}

export function buildMuseStatusTooltip(opts: {
  modeLabel: string;
  modeDescription: string;
  sessionId: string;
  folderName?: string | null;
}): string {
  const lines = [
    "Muse CLI Chat",
    `Mode: ${opts.modeLabel}`,
    `Session: ${shortSessionId(opts.sessionId)}`,
  ];
  if (opts.folderName) {
    lines.push(`Folder: ${opts.folderName}`);
  }
  if (opts.modeDescription) {
    lines.push("", opts.modeDescription);
  }
  lines.push("", "Click to open Muse chat.");
  return lines.join("\n");
}

export function buildModeBannerText(
  modeLabel: string,
  modeDescription: string,
): string {
  const label = modeLabel.trim() || "Headless";
  if (!modeDescription.trim()) {
    return `${label} mode active.`;
  }
  return `${label} mode active — ${modeDescription}`;
}
