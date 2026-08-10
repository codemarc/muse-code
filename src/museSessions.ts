import { existsSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { museSessionIndexPath } from "./museDataPaths";

export interface MuseSessionSummary {
  sessionId: string;
  title: string;
  firstUserPrompt: string | null;
  workspaceRoot: string | null;
  updatedAtUs: number;
  createdAtUs: number;
  promptCount: number;
  sessionLogPath: string | null;
  status: string;
}

function normalizeWorkspacePath(workspacePath: string): string[] {
  const trimmed = workspacePath.trim();
  const keys = new Set<string>([trimmed]);
  try {
    keys.add(realpathSync(trimmed));
  } catch {
    // ignore
  }
  return [...keys];
}

function rowToSummary(row: Record<string, unknown>): MuseSessionSummary {
  return {
    sessionId: String(row.session_id),
    title: String(row.title ?? row.session_id).trim() || String(row.session_id),
    firstUserPrompt:
      row.first_user_prompt == null ? null : String(row.first_user_prompt),
    workspaceRoot:
      row.workspace_root == null ? null : String(row.workspace_root),
    updatedAtUs: Number(row.updated_at_us ?? 0),
    createdAtUs: Number(row.created_at_us ?? 0),
    promptCount: Number(row.prompt_count ?? 0),
    sessionLogPath:
      row.session_log_path == null ? null : String(row.session_log_path),
    status: String(row.status ?? ""),
  };
}

function listViaNodeSqlite(
  indexPath: string,
  keys: string[],
  limit: number,
): MuseSessionSummary[] | null {
  try {
    const mod = require("node:sqlite") as typeof import("node:sqlite");
    const db = new mod.DatabaseSync(indexPath, { readOnly: true });
    try {
      const placeholders = keys.map(() => "?").join(", ");
      const sql = `
        SELECT
          session_id,
          title,
          first_user_prompt,
          workspace_root,
          updated_at_us,
          created_at_us,
          prompt_count,
          session_log_path,
          status
        FROM sessions
        WHERE workspace_key IN (${placeholders})
           OR workspace_root IN (${placeholders})
        ORDER BY updated_at_us DESC, created_at_us DESC
        LIMIT ?
      `;
      const rows = db.prepare(sql).all(...keys, ...keys, limit) as Record<
        string,
        unknown
      >[];
      return rows.map(rowToSummary);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function listViaSqliteCli(
  indexPath: string,
  keys: string[],
  limit: number,
): MuseSessionSummary[] {
  const inList = keys.map(sqlQuote).join(", ");
  const sql = `
    SELECT
      session_id,
      title,
      first_user_prompt,
      workspace_root,
      updated_at_us,
      created_at_us,
      prompt_count,
      session_log_path,
      status
    FROM sessions
    WHERE workspace_key IN (${inList})
       OR workspace_root IN (${inList})
    ORDER BY updated_at_us DESC, created_at_us DESC
    LIMIT ${limit};
  `;
  const result = spawnSync("sqlite3", ["-json", indexPath, sql], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return [];
  }
  const raw = (result.stdout || "").trim();
  if (!raw) {
    return [];
  }
  try {
    const rows = JSON.parse(raw) as Record<string, unknown>[];
    return rows.map(rowToSummary);
  } catch {
    return [];
  }
}

/**
 * List retained Muse sessions for a workspace from the local session index.
 * Prefers Node `node:sqlite`, falls back to the `sqlite3` CLI.
 */
export function listMuseSessionsForWorkspace(
  workspacePath: string,
  opts: { limit?: number; indexPath?: string } = {},
): MuseSessionSummary[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 40, 100));
  const indexPath = opts.indexPath ?? museSessionIndexPath();
  if (!existsSync(indexPath)) {
    return [];
  }
  const keys = normalizeWorkspacePath(workspacePath);
  if (!keys.length) {
    return [];
  }

  const viaNode = listViaNodeSqlite(indexPath, keys, limit);
  if (viaNode !== null) {
    return viaNode;
  }
  return listViaSqliteCli(indexPath, keys, limit);
}

export function formatSessionPickLabel(session: MuseSessionSummary): string {
  const short = session.sessionId.slice(0, 8);
  const when =
    session.updatedAtUs > 0
      ? new Date(session.updatedAtUs / 1000).toLocaleString()
      : "";
  const title = session.title || session.firstUserPrompt || short;
  const clipped = title.length > 64 ? `${title.slice(0, 64)}…` : title;
  const count = session.promptCount > 0 ? ` · ${session.promptCount} turn(s)` : "";
  return when ? `${clipped}  (${short}${count} · ${when})` : `${clipped}  (${short}${count})`;
}
