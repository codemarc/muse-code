import { describe, expect, test } from "bun:test";
import {
  buildAttachedPrompt,
  formatDiagnosticsBlock,
  formatEditorsBlock,
  formatFileBlock,
  formatTerminalBlock,
  stripAttachedContext,
  summarizeAttachments,
  type AttachmentRequest,
} from "./contextAttachments";

describe("formatFileBlock", () => {
  test("wraps content with path header", () => {
    const block = formatFileBlock("src/app.ts", "const x = 1;\n");
    expect(block).toContain('<file path="src/app.ts">');
    expect(block).toContain("const x = 1;");
    expect(block).toContain("</file>");
  });

  test("marks truncated content", () => {
    const block = formatFileBlock("big.txt", "abc", { truncated: true });
    expect(block).toContain("truncated");
  });
});

describe("formatDiagnosticsBlock", () => {
  test("renders one line per diagnostic", () => {
    const block = formatDiagnosticsBlock([
      {
        path: "src/app.ts",
        line: 3,
        character: 5,
        severity: "error",
        message: "Cannot find name 'x'.",
        source: "ts",
      },
    ]);
    expect(block).toContain("<problems>");
    expect(block).toContain("src/app.ts:3:5");
    expect(block).toContain("error");
    expect(block).toContain("Cannot find name 'x'.");
  });

  test("empty diagnostics render a placeholder", () => {
    expect(formatDiagnosticsBlock([])).toContain("No problems");
  });
});

describe("formatTerminalBlock", () => {
  test("wraps recent output with command header", () => {
    const block = formatTerminalBlock([
      { command: "bun test", output: "3 pass\n0 fail\n", exitCode: 0 },
    ]);
    expect(block).toContain("<terminal>");
    expect(block).toContain("bun test");
    expect(block).toContain("3 pass");
  });

  test("empty terminal history renders a placeholder", () => {
    expect(formatTerminalBlock([])).toContain("No terminal output");
  });
});

describe("formatEditorsBlock", () => {
  test("renders each open editor with contents", () => {
    const block = formatEditorsBlock([
      { path: "a.ts", content: "aaa" },
      { path: "b.ts", content: "bbb" },
    ]);
    expect(block).toContain("a.ts");
    expect(block).toContain("aaa");
    expect(block).toContain("b.ts");
  });
});

describe("buildAttachedPrompt", () => {
  test("appends context blocks after the prompt", () => {
    const out = buildAttachedPrompt("fix this", ["<file>hi</file>"]);
    expect(out.startsWith("fix this")).toBe(true);
    expect(out).toContain("<attached-context>");
    expect(out).toContain("<file>hi</file>");
    expect(out).toContain("</attached-context>");
  });

  test("returns the prompt unchanged with no blocks", () => {
    expect(buildAttachedPrompt("hello", [])).toBe("hello");
  });
});

describe("stripAttachedContext", () => {
  test("removes the attached block and reports labels", () => {
    const full = buildAttachedPrompt("fix this", [
      '<file path="a.ts">hi</file>',
      "<problems>none</problems>",
    ]);
    const stripped = stripAttachedContext(full);
    expect(stripped.display).toBe("fix this");
    expect(stripped.attached.length).toBe(2);
  });

  test("leaves plain prompts untouched", () => {
    const stripped = stripAttachedContext("hello");
    expect(stripped.display).toBe("hello");
    expect(stripped.attached).toEqual([]);
  });
});

describe("summarizeAttachments", () => {
  test("labels each attachment kind", () => {
    const reqs: AttachmentRequest[] = [
      { kind: "file", path: "src/app.ts" },
      { kind: "problems" },
      { kind: "terminal" },
      { kind: "editors" },
    ];
    const labels = summarizeAttachments(reqs);
    expect(labels).toEqual([
      "src/app.ts",
      "Problems",
      "Terminal",
      "Open editors",
    ]);
  });
});
