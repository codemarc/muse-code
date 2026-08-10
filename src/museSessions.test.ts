import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  formatSessionPickLabel,
  listMuseSessionsForWorkspace,
} from "./museSessions";

function createIndexDb(dbPath: string): void {
  const sql = `
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  session_stream_id TEXT NOT NULL,
  session_dir TEXT NOT NULL,
  session_log_path TEXT NOT NULL UNIQUE,
  layout TEXT NOT NULL,
  workspace_root TEXT,
  workspace_key TEXT,
  provider_id TEXT,
  model_id TEXT,
  git_branch TEXT,
  title TEXT NOT NULL,
  first_user_prompt TEXT,
  search_text TEXT NOT NULL,
  created_at_us INTEGER,
  updated_at_us INTEGER,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  status_rank INTEGER NOT NULL,
  source_fingerprint TEXT,
  indexed_at_us INTEGER NOT NULL,
  latest_segment_terminated INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sessions (
  session_id, session_stream_id, session_dir, session_log_path, layout,
  workspace_root, workspace_key, title, first_user_prompt, search_text,
  created_at_us, updated_at_us, prompt_count, status, status_rank, indexed_at_us
) VALUES (
  '11111111-1111-1111-1111-111111111111', 's', '/tmp/s', '/tmp/s/session.jsonl', 'v1',
  '/tmp/proj', '/tmp/proj', 'hello world', 'hello world', 'hello world',
  100, 200, 2, 'valid', 0, 200
);
INSERT INTO sessions (
  session_id, session_stream_id, session_dir, session_log_path, layout,
  workspace_root, workspace_key, title, first_user_prompt, search_text,
  created_at_us, updated_at_us, prompt_count, status, status_rank, indexed_at_us
) VALUES (
  '22222222-2222-2222-2222-222222222222', 's2', '/tmp/s2', '/tmp/s2/session.jsonl', 'v1',
  '/other', '/other', 'other', 'other', 'other',
  100, 300, 1, 'valid', 0, 300
);
`;
  const result = spawnSync("sqlite3", [dbPath], {
    input: sql,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "sqlite3 failed to create fixture db");
  }
}

describe("museSessions", () => {
  test("lists sessions for matching workspace keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-cli-chat-idx-"));
    const dbPath = join(dir, "session-index.db");
    try {
      createIndexDb(dbPath);
      const listed = listMuseSessionsForWorkspace("/tmp/proj", {
        indexPath: dbPath,
        limit: 10,
      });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.sessionId).toBe("11111111-1111-1111-1111-111111111111");
      expect(listed[0]?.title).toBe("hello world");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("formatSessionPickLabel includes short id", () => {
    const label = formatSessionPickLabel({
      sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      title: "Fix the login bug",
      firstUserPrompt: "Fix the login bug",
      workspaceRoot: "/tmp",
      updatedAtUs: 0,
      createdAtUs: 0,
      promptCount: 3,
      sessionLogPath: null,
      status: "valid",
    });
    expect(label).toContain("aaaaaaaa");
    expect(label).toContain("Fix the login bug");
    expect(label).toContain("3 turn");
  });
});
