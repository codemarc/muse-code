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
  test("native branch seed public turns precede new turns; internal prefix and duplicate replay stay hidden", () => {
    const fork = { payload_type: "session.fork.turn", payload: { turn_index: 0,
      turn: { prompt: "Remember inherited-code", answer: "Parent ready", source: { run_id: "parent-run" } } } };
    const started = (run_id: string, prompt: string) => ({ payload_type: "runtime.session", payload: { kind: "run", run_id, event: { kind: "started", prompt } } });
    const result = transcriptFromSessionJsonl([
      { payload_type: "session.fork.model_prefix", payload: { model_messages: [{ role: "developer", content: "Never display internal prefix" }] } },
      fork, fork, started("parent-run", "Remember inherited-code"),
      { payload_type: "runtime.session", payload: { kind: "run", run_id: "parent-run", event: { kind: "assistant_message_committed", text: "Parent ready" } } },
      started("child-run", "What was the code?"),
      { payload_type: "runtime.session", payload: { kind: "run", run_id: "child-run", event: { kind: "assistant_message_committed", text: "inherited-code" } } },
    ].map((r) => JSON.stringify(r)).join("\n"));
    expect(result).toEqual([
      { type: "user", text: "Remember inherited-code" }, { type: "assistant", text: "Parent ready" },
      { type: "user", text: "What was the code?" }, { type: "assistant", text: "inherited-code" },
    ]);
  });

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
