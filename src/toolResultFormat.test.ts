import { describe, expect, test } from "bun:test";
import {
  formatExecEnvelope,
  formatToolResult,
  isExecEnvelope,
} from "./toolResultFormat";

const sampleExec = {
  chunk_id: "exec-2-1",
  command: "ls -lah /tmp/media",
  description: "Check media assets",
  exit_code: 0,
  terminal_status: "completed",
  output: "total 72\n-rw-r--r-- icon.png\n",
  original_output_bytes: 767,
  original_output_tokens: 192,
  truncated: false,
};

describe("toolResultFormat", () => {
  test("detects exec envelope", () => {
    expect(isExecEnvelope(sampleExec)).toBe(true);
    expect(isExecEnvelope({ command: "x" })).toBe(false);
    expect(isExecEnvelope("string")).toBe(false);
  });

  test("formats exec envelope as terminal-style text", () => {
    const view = formatExecEnvelope(sampleExec);
    expect(view).toContain("$ ls -lah /tmp/media  # Check media assets");
    expect(view).toContain("exit 0");
    expect(view).toContain("total 72");
    expect(view).not.toContain("chunk_id");
  });

  test("formatToolResult returns readable view for exec objects", () => {
    const formatted = formatToolResult(sampleExec);
    expect(formatted.resultView).toContain("exit 0");
    expect(formatted.resultRaw).toContain("chunk_id");
    expect(formatted.execMeta?.exitCode).toBe(0);
    expect(formatted.execMeta?.description).toBe("Check media assets");
  });

  test("formatToolResult parses JSON strings", () => {
    const formatted = formatToolResult(JSON.stringify(sampleExec));
    expect(formatted.resultView).toContain("$ ls -lah /tmp/media");
  });

  test("formatToolResult leaves plain strings without view", () => {
    const formatted = formatToolResult("ok from tool");
    expect(formatted.resultRaw).toBe("ok from tool");
    expect(formatted.resultView).toBeNull();
  });

  test("marks truncated output", () => {
    const view = formatExecEnvelope({ ...sampleExec, truncated: true });
    expect(view).toContain("(output truncated)");
  });
});
