import { expect, test } from "bun:test";
import { appendLiveUiEvent, preserveStoppedTranscript, preserveToolMetadata, type TranscriptItem } from "./transcript";

test("retains interrupted text when the process did not flush its log", () => {
  const cache: TranscriptItem[] = [{ type: "user", text: "go" }, { type: "assistant", text: "partial output" }, { type: "status", text: "Stopped" }];
  expect(preserveStoppedTranscript(cache, [{ type: "user", text: "go" }])).toBe(cache);
  expect(preserveStoppedTranscript(cache, [{ type: "user", text: "go" }, { type: "assistant", text: "partial" }])).toBe(cache);
});

test("accepts a newer or different authoritative transcript", () => {
  const cache: TranscriptItem[] = [{ type: "user", text: "go" }, { type: "assistant", text: "partial" }, { type: "status", text: "Stopped" }];
  const completed: TranscriptItem[] = [{ type: "user", text: "go" }, { type: "assistant", text: "partial output finished" }];
  const different: TranscriptItem[] = [{ type: "user", text: "another turn" }];
  expect(preserveStoppedTranscript(cache, completed)).toBe(completed);
  expect(preserveStoppedTranscript(cache, different)).toBe(different);
  expect(preserveStoppedTranscript(cache.slice(0, -1), completed)).toBe(completed);
});

test("tool failure facts and real exit codes survive cache and history hydration by call id", () => {
  const cached = appendLiveUiEvent([], { kind: "tool", name: "powershell", callId: "call-a", status: "failed", resultRaw: "live failure", execMeta: { command: "exit 7", exitCode: 7 } });
  const loaded: TranscriptItem[] = [{ type: "tool", name: "call-a", callId: "call-a", resultRaw: "complete durable failure output" }, { type: "tool", name: "powershell", callId: "call-b", resultRaw: "unrelated" }];
  const merged = preserveToolMetadata(cached, loaded);
  expect(merged[0]).toEqual({ type: "tool", name: "powershell", callId: "call-a", status: "failed", resultRaw: "complete durable failure output", execMeta: { command: "exit 7", exitCode: 7 } });
  expect(merged[1]).toBe(loaded[1]);
  expect(loaded[0]).not.toHaveProperty("status");
});

test("reused provider call ids never transfer one turn's outcome onto another", () => {
  const cached: TranscriptItem[] = [{ type: "tool", name: "powershell", callId: "reused", status: "failed" }, { type: "tool", name: "powershell", callId: "reused", status: "completed" }];
  const loaded: TranscriptItem[] = [{ type: "tool", name: "tool", callId: "reused", resultRaw: "original" }];
  expect(preserveToolMetadata(cached, loaded)[0]).toBe(loaded[0]);
  expect(preserveToolMetadata(cached.slice(0, 1), [...loaded, ...loaded])).toEqual([...loaded, ...loaded]);
});
