/** Execution modes exposed by Muse CLI Chat.
 *
 * `headless` is the current JSONL-backed native chat path.
 * `interactive` delegates execution to the Muse terminal so Muse can ask for
 * approvals and other interactive input. MSP is intentionally not exposed
 * until its host implementation is integrated.
 */
export type ExecutionMode = "headless" | "interactive";

export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  headless: "Headless",
  interactive: "Interactive",
};

export function normalizeExecutionMode(value: unknown): ExecutionMode {
  return value === "interactive" ? "interactive" : "headless";
}

export function executionModeDescription(mode: ExecutionMode): string {
  return mode === "interactive"
    ? "Muse runs in the integrated terminal and can ask for approvals."
    : "Native chat runs Muse exec through the JSONL stream; interactive approvals are unavailable.";
}
