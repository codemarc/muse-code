import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  transcriptFromExportJson,
  transcriptFromSessionJsonl,
} from "./museHistory";
import { appendLiveUiEvent } from "./transcript";

const fixture = readFileSync(
  join(import.meta.dir, "..", "fixtures", "session_runtime_history.jsonl"),
  "utf8",
);

describe("museHistory", () => {
  test("extracts user, tool, assistant from runtime.session jsonl", () => {
    const items = transcriptFromSessionJsonl(fixture);
    expect(items.map((i) => i.type)).toEqual(["user", "tool", "assistant"]);
    expect(items[0]).toEqual({ type: "user", text: "Reply with exactly: pong" });
    expect(items[1]).toMatchObject({ type: "tool", resultRaw: "ok from tool" });
    expect(items[2]).toEqual({ type: "assistant", text: "pong" });
  });

  test("dedupes repeated started prompts", () => {
    const items = transcriptFromSessionJsonl(fixture);
    expect(items.filter((i) => i.type === "user")).toHaveLength(1);
  });

  test("reads envelopes from export document shape", () => {
    const lines = fixture.trim().split("\n");
    const doc = {
      export_schema_version: 1,
      events: lines.map((line) => ({
        kind: "record",
        envelope: JSON.parse(line),
      })),
    };
    const items = transcriptFromExportJson(JSON.stringify(doc));
    expect(items[0]?.type).toBe("user");
    expect(items.at(-1)).toEqual({ type: "assistant", text: "pong" });
  });
});

describe("appendLiveUiEvent", () => {
  test("merges assistant deltas then final", () => {
    let items = appendLiveUiEvent([], { kind: "user", prompt: "hi" });
    items = appendLiveUiEvent(items, { kind: "assistant_delta", text: "he" });
    items = appendLiveUiEvent(items, { kind: "assistant_delta", text: "llo" });
    items = appendLiveUiEvent(items, {
      kind: "assistant_final",
      text: "hello",
      terminal: "completed",
    });
    expect(items).toEqual([
      { type: "user", text: "hi" },
      { type: "assistant", text: "hello" },
    ]);
  });
});
