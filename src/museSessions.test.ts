import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  deleteMuseSessions,
  retainedBranchForWorkspace,
  formatSessionPickLabel,
  isPathInsideJail,
  listMuseSessionsForWorkspace,
} from "./museSessions";

function createIndexDb(
  dbPath: string,
  rows: Array<{
    id: string;
    workspace: string | null;
    sessionDir: string;
    logPath: string;
  }>,
): void {
  const inserts = rows
    .map(
      (r, i) => `
INSERT INTO sessions (
  session_id, session_stream_id, session_dir, session_log_path, layout,
  workspace_root, workspace_key, title, first_user_prompt, search_text,
  created_at_us, updated_at_us, prompt_count, status, status_rank, indexed_at_us
) VALUES (
  '${r.id}', 's${i}', '${r.sessionDir}', '${r.logPath}', 'v1',
  ${r.workspace === null ? "NULL" : `'${r.workspace}'`}, ${r.workspace === null ? "NULL" : `'${r.workspace}'`}, '${r.workspace === null ? "" : `title-${i}`}', ${r.workspace === null ? "NULL" : `'prompt-${i}'`}, 'search',
  100, ${200 + i}, 1, 'valid', 0, 200
);`,
    )
    .join("\n");

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
${inserts}
`;
  const result = spawnSync("node", ["-e", `
    const { DatabaseSync } = require('node:sqlite');
    const { readFileSync } = require('node:fs');
    const db = new DatabaseSync(process.argv[1]);
    try { db.exec(readFileSync(0, 'utf8')); } finally { db.close(); }
  `, dbPath], {
    input: sql,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Node SQLite failed to create fixture db");
  }
}

describe("museSessions", () => {
  test("registered unindexed forks require matching durable ancestry and workspace evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-fork-"));
    const parent = "01a1d11b-945f-7000-ad8d-723cd8a0944a";
    const child = "00000000-0000-724b-b11c-0e905a1e87ef";
    const home = join(dir, "2026", "11", "13", child);
    mkdirSync(home, { recursive: true });
    const path = join(home, "session.jsonl");
    const records = [
      { payload_type: "session.fork.created", payload: { fork_session_id: child, source_session_id: parent } },
      { payload_type: "session.fork.turn", payload: { turn_index: 0, turn: { prompt: "Parent prompt", answer: "Parent answer" } } },
      { payload_type: "runtime.session.metadata", payload: { kind: "metadata", record: { workspace_root: "/workspace" } } },
    ];
    try {
      writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n"));
      const before = readFileSync(path);
      const hit = retainedBranchForWorkspace("/workspace", child, parent, dir);
      expect(hit?.sessionLogPath).toBe(path);
      expect(hit?.firstUserPrompt).toBe("Parent prompt");
      expect(hit?.promptCount).toBe(1);
      expect(retainedBranchForWorkspace("/other", child, parent, dir)).toBeUndefined();
      expect(retainedBranchForWorkspace("/workspace", child, child, dir)).toBeUndefined();
      expect(retainedBranchForWorkspace("/workspace", "../other", parent, dir)).toBeUndefined();
      expect(readFileSync(path).equals(before)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test("recovers MSP-cleared workspace bindings from verified local logs without changing the index", () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-unbound-"));
    const indexPath = join(dir, "session-index.db");
    const root = join(dir, "workspace");
    const other = join(dir, "other");
    const log = (workspace: string, prompt: string) => [
      JSON.stringify({ payload_type: "runtime.command_intake.received", payload: { record: { command: { kind: "session_start", session_metadata: { workspace_root: workspace } } } } }),
      JSON.stringify({ payload_type: "runtime.session", payload: { kind: "run", event: { kind: "started", prompt } } }),
    ].join("\n");
    try {
      const paths = ["ours", "other", "moved", "unverified"].map((name) => join(dir, `${name}.jsonl`));
      writeFileSync(paths[0], log(root, "Retained panel draft"));
      writeFileSync(paths[1], log(other, "Private other workspace"));
      writeFileSync(paths[2], log(root, "Moved away") + "\n" + JSON.stringify({ payload_type: "session.workspace_branch.observed", payload: { record: { workspace_root: other } } }));
      writeFileSync(paths[3], 'not a session record');
      createIndexDb(indexPath, paths.map((logPath, i) => ({ id: `unbound-${i}`, workspace: null, logPath, sessionDir: dir })));
      const before = readFileSync(indexPath);
      const sessions = listMuseSessionsForWorkspace(root, { indexPath });
      expect(sessions.map((s) => s.sessionId)).toEqual(["unbound-0"]);
      expect(sessions[0].title).toBe("Retained panel draft");
      expect(sessions[0].workspaceRoot).toBe(root);
      expect(listMuseSessionsForWorkspace(root, { indexPath, query: "RETAINED PANEL" }).map((s) => s.sessionId)).toEqual(["unbound-0"]);
      expect(listMuseSessionsForWorkspace(root, { indexPath, query: "Private other" })).toEqual([]);
      expect(readFileSync(indexPath).equals(before)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test("search applies before the recent-results limit and is scoped to the workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-search-"));
    const indexPath = join(dir, "session-index.db");
    try {
      createIndexDb(indexPath, Array.from({ length: 106 }, (_, i) => ({
        id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        workspace: i === 105 ? "/other" : "/tmp/proj",
        sessionDir: `/tmp/s${i}`, logPath: `/tmp/s${i}/session.jsonl`,
      })));
      const opts = { indexPath, limit: 40 };
      expect(listMuseSessionsForWorkspace("/tmp/proj", opts)).toHaveLength(40);
      const old = listMuseSessionsForWorkspace("/tmp/proj", { ...opts, query: "PROMPT-0" });
      expect(old).toHaveLength(1);
      expect(old[0].sessionId).toBe("00000000-0000-0000-0000-000000000000");
      expect(listMuseSessionsForWorkspace("/tmp/proj", { ...opts, query: "title-104" })[0].title).toBe("title-104");
      expect(listMuseSessionsForWorkspace("/tmp/proj", { ...opts, query: old[0].sessionId })).toHaveLength(1);
      expect(listMuseSessionsForWorkspace("/tmp/proj", { ...opts, query: "prompt-105" })).toHaveLength(0);
      expect(listMuseSessionsForWorkspace("/tmp/proj", { ...opts, query: "' OR 1=1 --" })).toHaveLength(0);
      expect(listMuseSessionsForWorkspace("/tmp/proj", { ...opts, query: "%_" })).toHaveLength(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test("lists sessions for matching workspace keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "muse-cli-chat-idx-"));
    const dbPath = join(dir, "session-index.db");
    try {
      createIndexDb(dbPath, [
        {
          id: "11111111-1111-1111-1111-111111111111",
          workspace: "/tmp/proj",
          sessionDir: "/tmp/s",
          logPath: "/tmp/s/session.jsonl",
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          workspace: "/other",
          sessionDir: "/tmp/s2",
          logPath: "/tmp/s2/session.jsonl",
        },
      ]);
      const listed = listMuseSessionsForWorkspace("/tmp/proj", {
        indexPath: dbPath,
        limit: 10,
      });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.sessionId).toBe("11111111-1111-1111-1111-111111111111");
      expect(listed[0]?.title).toBe("title-0");
      expect(listed[0]?.sessionDir).toBe("/tmp/s");
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
      sessionDir: null,
      status: "valid",
    });
    expect(label).toContain("aaaaaaaa");
    expect(label).toContain("Fix the login bug");
    expect(label).toContain("3 turn");
  });

  test("isPathInsideJail accepts children only", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-jail-"));
    try {
      const child = join(root, "abc");
      mkdirSync(child);
      expect(isPathInsideJail(child, root)).toBe(true);
      expect(isPathInsideJail(root, root)).toBe(true);
      expect(isPathInsideJail("/tmp", root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("deleteMuseSessions removes workspace rows and jailed dirs only", () => {
    const root = mkdtempSync(join(tmpdir(), "muse-cli-chat-del-"));
    const jail = join(root, "sessions");
    const keepOutside = join(root, "outside-session");
    const doomed = join(jail, "doomed");
    const otherWs = join(jail, "other-ws");
    mkdirSync(doomed, { recursive: true });
    mkdirSync(otherWs, { recursive: true });
    mkdirSync(keepOutside, { recursive: true });
    writeFileSync(join(doomed, "session.jsonl"), "x");
    writeFileSync(join(keepOutside, "session.jsonl"), "keep");
    writeFileSync(join(otherWs, "session.jsonl"), "other");

    const dbPath = join(root, "session-index.db");
    createIndexDb(dbPath, [
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        workspace: "/tmp/proj",
        sessionDir: doomed,
        logPath: join(doomed, "session.jsonl"),
      },
      {
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        workspace: "/tmp/proj",
        sessionDir: keepOutside,
        logPath: join(keepOutside, "session.jsonl"),
      },
      {
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        workspace: "/other",
        sessionDir: otherWs,
        logPath: join(otherWs, "session.jsonl"),
      },
    ]);

    try {
      const result = deleteMuseSessions({
        workspacePath: "/tmp/proj",
        sessionIds: [
          "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          "cccccccc-cccc-cccc-cccc-cccccccccccc",
        ],
        indexPath: dbPath,
        sessionsJail: jail,
      });

      expect(result.deletedIds.sort()).toEqual([
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      ]);
      expect(result.errors).toEqual([]);

      const remaining = listMuseSessionsForWorkspace("/tmp/proj", {
        indexPath: dbPath,
        limit: 10,
      });
      expect(remaining).toHaveLength(0);

      const other = listMuseSessionsForWorkspace("/other", {
        indexPath: dbPath,
        limit: 10,
      });
      expect(other).toHaveLength(1);
      expect(other[0]?.sessionId).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");

      // Jailed doomed dir removed; outside path and other workspace kept.
      expect(readFileSync(join(keepOutside, "session.jsonl"), "utf8")).toBe(
        "keep",
      );
      expect(readFileSync(join(otherWs, "session.jsonl"), "utf8")).toBe("other");
      let doomedGone = false;
      try {
        readFileSync(join(doomed, "session.jsonl"), "utf8");
      } catch {
        doomedGone = true;
      }
      expect(doomedGone).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
