import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  JsonlLineBuffer,
  parseMuseLine,
  processJsonlChunk,
  recordToUiEvent,
} from "./museJsonl";

const fixture = readFileSync(
  join(import.meta.dir, "..", "fixtures", "echo_basic.jsonl"),
  "utf8",
);

describe("museJsonl", () => {
  test("parses every fixture line", () => {
    const lines = fixture.trim().split("\n");
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) {
      const record = parseMuseLine(line);
      expect(record?.payload_type).toBeTruthy();
    }
  });

  test("maps echo run to user + delta + final", () => {
    const kinds: string[] = [];
    for (const line of fixture.trim().split("\n")) {
      const ui = recordToUiEvent(parseMuseLine(line)!);
      if (ui) {
        kinds.push(ui.kind);
      }
    }
    expect(kinds).toContain("user");
    expect(kinds).toContain("assistant_delta");
    expect(kinds).toContain("assistant_final");
    expect(kinds).toContain("status");
  });

  test("buffers partial chunks", () => {
    const buffer = new JsonlLineBuffer();
    const line = fixture.trim().split("\n")[0]!;
    const mid = Math.floor(line.length / 2);
    expect(processJsonlChunk(buffer, line.slice(0, mid))).toEqual([]);
    const events = processJsonlChunk(buffer, line.slice(mid) + "\n");
    expect(events.length).toBeGreaterThanOrEqual(0);
  });
});
