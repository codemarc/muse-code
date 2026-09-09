import { describe, expect, test } from "bun:test";
import {
  MUSE_AI_URL,
  selectHandoffTranscript,
  transcriptToMarkdown,
} from "./transcriptMarkdown";
import type { TranscriptItem } from "./transcript";

describe("MUSE_AI_URL", () => {
  test("points at the consumer app, not Muse Code docs", () => {
    expect(MUSE_AI_URL).toBe("https://muse.ai/");
    expect(MUSE_AI_URL).not.toContain("developer.meta.com");
    expect(MUSE_AI_URL).not.toContain("dev.meta.ai");
  });
});

describe("transcriptToMarkdown", () => {
  test("renders user and assistant turns with session metadata", () => {
    const md = transcriptToMarkdown(
      [
        { type: "user", text: "fix the kiosk tax" },
        { type: "assistant", text: "I'll inspect the POS tax path." },
      ],
      { sessionId: "abc-123", workspaceName: "pos" },
    );
    expect(md).toContain("# Muse Code session");
    expect(md).toContain("`abc-123`");
    expect(md).toContain("pos");
    expect(md).toContain("## User");
    expect(md).toContain("fix the kiosk tax");
    expect(md).toContain("## Muse");
    expect(md).toContain("I'll inspect the POS tax path.");
    expect(md).toContain("muse.ai");
  });

  test("includes tool output and skips empty or noisy items", () => {
    const md = transcriptToMarkdown([
      { type: "user", text: "  " },
      { type: "tool", name: "exec", resultRaw: "exit 0\nok" },
      { type: "status", text: "running" },
    ]);
    expect(md).toContain("## Tool `exec`");
    expect(md).toContain("ok");
    expect(md).not.toContain("## User");
    expect(md).not.toContain("running");
  });

  test("renders exec envelopes as readable tool output", () => {
    const md = transcriptToMarkdown([
      {
        type: "tool",
        name: "CALL_1",
        resultRaw: JSON.stringify({
          command: "ls",
          output: "README.md",
          exit_code: 0,
        }),
      },
    ]);
    expect(md).toContain("$ ls");
    expect(md).toContain("README.md");
    expect(md).toContain("exit 0");
  });

  test("returns empty string when there is nothing to hand off", () => {
    expect(transcriptToMarkdown([])).toBe("");
    expect(
      transcriptToMarkdown([{ type: "status", text: "idle" }]),
    ).toBe("");
  });

  test("truncates oversized transcripts", () => {
    const md = transcriptToMarkdown([
      { type: "user", text: "x".repeat(200_000) },
    ]);
    expect(md.length).toBeLessThan(120_000);
    expect(md.toLowerCase()).toContain("truncated");
  });
});

describe("selectHandoffTranscript", () => {
  const live: TranscriptItem[] = [{ type: "user", text: "live" }];
  const exported: TranscriptItem[] = [
    { type: "user", text: "one" },
    { type: "assistant", text: "two" },
  ];

  test("uses live items while a run is in progress", () => {
    expect(
      selectHandoffTranscript({
        liveItems: live,
        exportedItems: exported,
        running: true,
      }),
    ).toEqual(live);
  });

  test("prefers export when idle and export has turns", () => {
    expect(
      selectHandoffTranscript({
        liveItems: live,
        exportedItems: exported,
        running: false,
      }),
    ).toEqual(exported);
  });

  test("falls back to live cache when export is empty", () => {
    expect(
      selectHandoffTranscript({
        liveItems: live,
        exportedItems: [],
        running: false,
      }),
    ).toEqual(live);
  });
});
