import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  readdirSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { museDataDir, museSessionIndexPath } from "./museDataPaths";
import { transcriptFromSessionLogPath } from "./museHistory";

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

/**
 * Index keys a workspace may be stored under.
 *
 * On Windows, VS Code reports `c:\proj` (lower-case drive) while Muse stores
 * `workspace_root` as `C:\proj` and `workspace_key` as the extended-length
 * `\\?\C:\proj`. SQL `IN` is case-sensitive, so emit those spellings too.
 */
export function sessionIndexKeys(
  workspacePath: string,
  platform: NodeJS.Platform = process.platform,
  realpath: (p: string) => string = realpathSync,
): string[] {
  const trimmed = workspacePath.trim();
  const keys = new Set<string>([trimmed]);
  try {
    keys.add(realpath(trimmed));
  } catch {
    // ignore
  }
  if (platform === "win32") {
    for (const k of [...keys]) {
      const plain = k.replace(/^\\\\\?\\/, "").replace(/[\\/]+$/, "");
      const upper = plain.replace(/^([a-z]):/, (_m, d: string) => `${d.toUpperCase()}:`);
      for (const v of [plain, upper]) {
        keys.add(v);
        if (/^[A-Za-z]:\\/.test(v)) {
          keys.add(`\\\\?\\${v}`);
        }
      }
    }
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
  query: string,
  unbound = false,
): MuseSessionSummary[] | null {
  try {
    const mod = require("node:sqlite") as typeof import("node:sqlite");
    const db = new mod.DatabaseSync(indexPath, { readOnly: true });
    try {
      const placeholders = keys.map(() => "?").join(", ");
      const sql = `
        SELECT ${SESSION_SELECT}
        FROM sessions
        WHERE ${unbound ? "(workspace_key IS NULL AND workspace_root IS NULL)" : `(workspace_key IN (${placeholders}) OR workspace_root IN (${placeholders}))`}
          AND instr(lower(COALESCE(title, '') || char(10) || COALESCE(first_user_prompt, '') || char(10) || session_id), lower(?)) > 0
        ORDER BY updated_at_us DESC, created_at_us DESC
        LIMIT ?
      `;
      const rows = db.prepare(sql).all(...(unbound ? [] : [...keys, ...keys]), query, limit) as Record<
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
  query: string,
  unbound = false,
): MuseSessionSummary[] {
  const inList = keys.map(sqlQuote).join(", ");
  const sql = `
    SELECT ${SESSION_SELECT}
    FROM sessions
    WHERE ${unbound ? "(workspace_key IS NULL AND workspace_root IS NULL)" : `(workspace_key IN (${inList}) OR workspace_root IN (${inList}))`}
      AND instr(lower(COALESCE(title, '') || char(10) || COALESCE(first_user_prompt, '') || char(10) || session_id), lower(${sqlQuote(query)})) > 0
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
  opts: { limit?: number; indexPath?: string; query?: string } = {},
): MuseSessionSummary[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 40, 100));
  const indexPath = opts.indexPath ?? museSessionIndexPath();
  if (!existsSync(indexPath)) {
    return [];
  }
  const keys = sessionIndexKeys(workspacePath);
  if (!keys.length) {
    return [];
  }

  const query = (opts.query ?? "").trim().slice(0, 256);
  const bound = listViaNodeSqlite(indexPath, keys, limit, query) ?? listViaSqliteCli(indexPath, keys, limit, query);
  // Muse MSP can clear both workspace columns when resuming an indexed session.
  // Recover only rows with positive local-log workspace evidence, without writing
  // to Muse's index or admitting another workspace's conversations to this list.
  const unboundQuery = /^[a-f0-9-]{36}$/i.test(query) ? query : "";
  const unbound = listViaNodeSqlite(indexPath, keys, 500, unboundQuery, true) ?? listViaSqliteCli(indexPath, keys, 500, unboundQuery, true);
  const recovered: MuseSessionSummary[] = [];
  for (const session of unbound) {
    const metadata = session.sessionLogPath ? retainedSessionMetadata(session.sessionLogPath) : null;
    if (!metadata?.workspaceRoot || !keys.some((key) => normalizedWorkspaceKey(key) === normalizedWorkspaceKey(metadata.workspaceRoot!))) continue;
    const candidate = { ...session, workspaceRoot: metadata.workspaceRoot,
      firstUserPrompt: session.firstUserPrompt ?? metadata.firstPrompt,
      title: session.title === session.sessionId ? metadata.firstPrompt || session.title : session.title };
    if ([candidate.title, candidate.firstUserPrompt ?? "", candidate.sessionId].join("\n").toLowerCase().includes(query.toLowerCase())) recovered.push(candidate);
  }
  return [...bound, ...recovered].sort((a, b) => b.updatedAtUs - a.updatedAtUs || b.createdAtUs - a.createdAtUs).slice(0, limit);
}

function normalizedWorkspaceKey(path: string): string {
  return process.platform === "win32" ? path.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase() : path;
}

const metadataCache = new Map<string, { stamp: string; workspaceRoot: string | null; firstPrompt: string | null }>();
const branchPaths = new Map<string, string>();

/** Only for extension-registered native forks: some Windows hosts omit their index row. */
export function retainedBranchForWorkspace(workspace: string, id: string, parentId: string,
  sessionsRoot = join(museDataDir(), "sessions")): MuseSessionSummary | undefined {
  if (![id, parentId].every((value) => /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))) return;
  const cacheKey = `${sessionsRoot}:${id}`;
  let path = branchPaths.get(cacheKey);
  try {
    if (!path || !existsSync(path)) {
      let remaining = 2048;
      const dirs = (at: string, pattern: RegExp) => readdirSync(at, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && pattern.test(entry.name)).map((entry) => entry.name).sort().reverse();
      outer: for (const year of dirs(sessionsRoot, /^\d{4}$/)) {
        for (const month of dirs(join(sessionsRoot, year), /^(0[1-9]|1[0-2])$/)) {
          for (const day of dirs(join(sessionsRoot, year, month), /^(0[1-9]|[12]\d|3[01])$/)) {
            if (--remaining < 0) break outer;
            const candidate = join(sessionsRoot, year, month, day, id, "session.jsonl");
            if (existsSync(candidate)) { path = candidate; break outer; }
          }
        }
      }
    }
    if (!path || !isPathInsideJail(path, sessionsRoot)) return;
    const info = statSync(path);
    if (!info.isFile() || info.size > 32 * 1024 * 1024) return;
    const first = readFileSync(path, "utf8").split("\n", 1)[0];
    const created = JSON.parse(first);
    if (created.payload_type !== "session.fork.created" || created.payload?.fork_session_id !== id || created.payload?.source_session_id !== parentId) return;
    const metadata = retainedSessionMetadata(path);
    if (metadata?.workspaceRoot && normalizedWorkspaceKey(metadata.workspaceRoot) !== normalizedWorkspaceKey(workspace)) return;
    branchPaths.set(cacheKey, path);
    const items = transcriptFromSessionLogPath(path);
    const prompts = items.filter((item) => item.type === "user");
    return { sessionId: id, title: prompts[0]?.text ?? id, firstUserPrompt: prompts[0]?.text ?? null,
      workspaceRoot: workspace, updatedAtUs: info.mtimeMs * 1000, createdAtUs: info.birthtimeMs * 1000,
      promptCount: prompts.length, sessionLogPath: path, sessionDir: join(path, ".."), status: "" };
  } catch { return; }
}
function retainedSessionMetadata(path: string) {
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size > 32 * 1024 * 1024) return null;
    const stamp = `${info.mtimeMs}:${info.size}`;
    const cached = metadataCache.get(path);
    if (cached?.stamp === stamp) return cached;
    let workspaceRoot: string | null = null;
    let firstPrompt: string | null = null;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.includes('"workspace_root"') && !line.includes('"started"')) continue;
      try {
        const row = JSON.parse(line);
        const root = row.payload_type === "runtime.command_intake.received" && row.payload?.record?.command?.kind === "session_start"
          ? row.payload.record.command.session_metadata?.workspace_root
          : row.payload_type === "runtime.session_start.intake_v3" ? row.payload?.payload?.session_metadata?.workspace_root
          : row.payload_type === "runtime.session.metadata" && row.payload?.kind === "metadata" ? row.payload?.record?.workspace_root
          : row.payload_type === "session.workspace_branch.observed" ? row.payload?.record?.workspace_root : undefined;
        if (typeof root === "string" && root) workspaceRoot = root;
        if (!firstPrompt && row.payload_type === "runtime.session" && row.payload?.kind === "run" && row.payload.event?.kind === "started" && typeof row.payload.event.prompt === "string") firstPrompt = row.payload.event.prompt.slice(0, 256);
      } catch { /* Partial/unrelated records do not establish workspace ownership. */ }
    }
    const result = { stamp, workspaceRoot, firstPrompt };
    if (statSync(path).size !== info.size) return null;
    if (metadataCache.size >= 128) metadataCache.delete(metadataCache.keys().next().value!);
    metadataCache.set(path, result);
    return result;
  } catch { return null; }
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
