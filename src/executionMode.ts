/** Execution modes exposed by Muse CLI Chat.
 *
 * `headless` is the current JSONL-backed native chat path.
 * `interactive` delegates execution to the Muse terminal so Muse can ask for
 * approvals and other interactive input. `panel` uses MSP to render approvals
 * and send explicit decisions in the native webview.
 */
export type ExecutionMode = "headless" | "interactive" | "panel" | "windows";

export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  headless: "Headless",
  interactive: "Interactive",
  panel: "Panel approvals",
  windows: "Windows compatibility",
};

export function normalizeExecutionMode(value: unknown): ExecutionMode {
  return value === "windows" ? "windows" : value === "panel" ? "panel" : value === "interactive" ? "interactive" : "headless";
}

export function executionModeDescription(mode: ExecutionMode): string {
  return mode === "windows" ? "Sandboxed Windows commands, with your existing Headless permissions."
    : mode === "panel" ? "Review tool permissions and answer questions here in chat."
    : mode === "interactive"
    ? "Muse runs in the integrated terminal and can ask for approvals."
    : "Chat in the editor with your existing Headless permissions. Interactive approvals are unavailable.";
}
