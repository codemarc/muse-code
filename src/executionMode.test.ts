import { describe, expect, test } from "bun:test";
import {
  executionModeDescription,
  EXECUTION_MODE_LABELS,
  normalizeExecutionMode,
} from "./executionMode";

describe("execution mode", () => {
  test("recognizes the explicit sandboxed Windows compatibility path", () => {
    expect(normalizeExecutionMode("windows")).toBe("windows");
    expect(EXECUTION_MODE_LABELS.windows).toBe("Windows compatibility");
    expect(executionModeDescription("windows")).toContain("Headless permission");
  });
  test("defaults unknown values to the safe headless mode", () => {
    expect(normalizeExecutionMode(undefined)).toBe("headless");
    expect(normalizeExecutionMode("msp")).toBe("headless");
  });

  test("recognizes interactive mode and explains its tradeoff", () => {
    expect(normalizeExecutionMode("interactive")).toBe("interactive");
    expect(EXECUTION_MODE_LABELS.interactive).toBe("Interactive");
    expect(executionModeDescription("interactive")).toContain("approvals");
  });
});
