import {
  existsSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { museDataDir, museSessionIndexPath } from "./museDataPaths";

export interface MuseSessionSummary {
  sessionId: string;
  title: string;
  firstUserPrompt: string | null;
  workspaceRoot: string | null;
  updatedAtUs: number;
  createdAtUs: number;
  promptCount: number;
  sessionLogPath: string | null;
  sessionDir: string | null;
  status: string;
}

export interface DeleteMuseSessionsResult {
  deletedIds: string[];
  errors: string[];
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
    sessionDir: row.session_dir == null ? null : String(row.session_dir),
    status: String(row.status ?? ""),
  };
}

const SESSION_SELECT = `
  session_id,
  title,
  first_user_prompt,
  workspace_root,
  updated_at_us,
  created_at_us,
  prompt_count,
  session_log_path,
  session_dir,
  status
`;

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
        SELECT ${SESSION_SELECT}
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
    SELECT ${SESSION_SELECT}
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

/** True if `candidate` resolves inside `jailRoot` (or equals it). */
export function isPathInsideJail(
  candidate: string,
  jailRoot: string,
): boolean {
  let realCandidate = candidate;
  let realJail = jailRoot;
  try {
    realJail = realpathSync(jailRoot);
  } catch {
    realJail = resolve(jailRoot);
  }
  try {
    realCandidate = existsSync(candidate)
      ? realpathSync(candidate)
      : resolve(candidate);
  } catch {
    realCandidate = resolve(candidate);
  }
  const root = realJail.endsWith(sep) ? realJail : realJail + sep;
  return realCandidate === realJail || realCandidate.startsWith(root);
}

export function museSessionsJail(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  return join(museDataDir(env, home), "sessions");
}

/**
 * Delete Muse sessions for a workspace from the local index and remove
 * session dirs that live under the Muse sessions jail.
 */
export function deleteMuseSessions(opts: {
  workspacePath: string;
  sessionIds: string[];
  indexPath?: string;
  sessionsJail?: string;
}): DeleteMuseSessionsResult {
  const wanted = new Set(
    opts.sessionIds.map((id) => id.trim()).filter(Boolean),
  );
  if (wanted.size === 0) {
    return { deletedIds: [], errors: [] };
  }

  const indexPath = opts.indexPath ?? museSessionIndexPath();
  const jail = opts.sessionsJail ?? museSessionsJail();
  const errors: string[] = [];

  if (!existsSync(indexPath)) {
    return { deletedIds: [], errors: ["Muse session index not found."] };
  }

  const allowed = listMuseSessionsForWorkspace(opts.workspacePath, {
    indexPath,
    limit: 100,
  }).filter((s) => wanted.has(s.sessionId));

  if (allowed.length === 0) {
    return {
      deletedIds: [],
      errors: ["No matching sessions for this workspace."],
    };
  }

  const ids = allowed.map((s) => s.sessionId);
  const deletedFromDb = deleteSessionRows(indexPath, ids);
  if (!deletedFromDb.ok) {
    return {
      deletedIds: [],
      errors: [
        deletedFromDb.error ??
          "Failed to delete from Muse session index (is Muse still open?).",
      ],
    };
  }

  for (const session of allowed) {
    const targets = [session.sessionDir, session.sessionLogPath].filter(
      (p): p is string => Boolean(p),
    );
    for (const target of targets) {
      // Prefer removing the session directory once.
      const dir =
        session.sessionDir && isPathInsideJail(session.sessionDir, jail)
          ? session.sessionDir
          : target;
      if (!isPathInsideJail(dir, jail)) {
        continue;
      }
      try {
        if (existsSync(dir)) {
          // If target is a file under session_dir, remove the jail-safe dir.
          const removePath =
            session.sessionDir && isPathInsideJail(session.sessionDir, jail)
              ? session.sessionDir
              : dir;
          rmSync(removePath, { recursive: true, force: true });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Could not remove ${dir}: ${msg}`);
      }
      // Only one filesystem remove attempt per session.
      break;
    }
  }

  return { deletedIds: ids, errors };
}

function deleteSessionRows(
  indexPath: string,
  sessionIds: string[],
): { ok: boolean; error?: string } {
  const viaNode = deleteViaNodeSqlite(indexPath, sessionIds);
  if (viaNode !== null) {
    return viaNode;
  }
  return deleteViaSqliteCli(indexPath, sessionIds);
}

function deleteViaNodeSqlite(
  indexPath: string,
  sessionIds: string[],
): { ok: boolean; error?: string } | null {
  let mod: typeof import("node:sqlite");
  try {
    mod = require("node:sqlite") as typeof import("node:sqlite");
  } catch {
    return null;
  }
  if (!mod?.DatabaseSync) {
    return null;
  }
  try {
    const db = new mod.DatabaseSync(indexPath);
    try {
      const placeholders = sessionIds.map(() => "?").join(", ");
      db.prepare(
        `DELETE FROM sessions WHERE session_id IN (${placeholders})`,
      ).run(...sessionIds);
      return { ok: true };
    } finally {
      db.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

function deleteViaSqliteCli(
  indexPath: string,
  sessionIds: string[],
): { ok: boolean; error?: string } {
  const inList = sessionIds.map(sqlQuote).join(", ");
  const sql = `DELETE FROM sessions WHERE session_id IN (${inList});`;
  const result = spawnSync("sqlite3", [indexPath, sql], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || "sqlite3 delete failed").trim(),
    };
  }
  return { ok: true };
}
