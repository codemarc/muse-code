import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile, chmod } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runGit } from "./gitReview";

export interface FileVersion { data: string; hash: string; mode: number }
export interface TurnFile { path: string; before: FileVersion | null; after: FileVersion | null }
export interface TurnCheckpoint {
  version: 1; id: string; workspace: string; sessionId: string; prompt: string; createdAt: number;
  state: "pending" | "complete" | "undone";
  baseline?: Record<string, FileVersion | null>;
  files: TurnFile[];
}
const MAX_FILE = 4 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const same = (a: FileVersion | null, b: FileVersion | null) => a === null || b === null
  ? a === b : a.hash === b.hash && a.mode === b.mode;
const missing = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT";

/** Refuse links/junctions, including links in parents of a not-yet-existing file. */
async function jailedPath(root: string, path: string): Promise<string> {
  const parts = path.split(/[\\/]/);
  if (!path || isAbsolute(path) || parts.some((p) => !p || p === "." || p === ".." || p.toLowerCase() === ".git") || path.includes("\0")) {
    throw new Error(`Unsafe checkpoint path: ${path}`);
  }
  const absolute = resolve(root, ...parts);
  const rel = relative(root, absolute);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error(`Path outside workspace: ${path}`);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Checkpoint cannot follow a link: ${path}`);
    } catch (err) { if (!missing(err)) throw err; }
  }
  return absolute;
}

async function readVersion(root: string, path: string): Promise<FileVersion | null> {
  const absolute = await jailedPath(root, path);
  try {
    const info = await lstat(absolute);
    if (!info.isFile()) throw new Error(`Checkpoint needs a regular file: ${path}`);
    if (info.size > MAX_FILE) throw new Error(`Checkpoint file exceeds 4 MB: ${path}`);
    const data = await readFile(absolute);
    return { data: data.toString("base64"), hash: hash(data), mode: info.mode & 0o777 };
  } catch (err) { if (missing(err)) return null; throw err; }
}

async function capture(root: string, additionalPaths: string[] = []): Promise<Record<string, FileVersion | null>> {
  const result = await runGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (!result.ok) throw new Error("Turn checkpoints require a Git workspace. Open a Git repository before sending.");
  const paths = [...new Set([...result.stdout.split("\0").filter(Boolean), ...additionalPaths])];
  if (paths.length > 20000) throw new Error("Workspace exceeds the checkpoint limit of 20,000 files.");
  const versions: Record<string, FileVersion | null> = Object.create(null);
  let total = 0;
  for (const path of paths) {
    const version = await readVersion(root, path);
    total += version ? Buffer.byteLength(version.data, "base64") : 0;
    if (total > MAX_TOTAL) throw new Error("Workspace checkpoint exceeds 64 MB. Ignore generated files before sending.");
    versions[path] = version;
  }
  return versions;
}

async function replaceVersion(root: string, path: string, version: FileVersion | null): Promise<void> {
  const absolute = await jailedPath(root, path);
  if (version === null) {
    await unlink(absolute).catch((err) => { if (!missing(err)) throw err; });
    return;
  }
  const data = Buffer.from(version.data, "base64");
  if (hash(data) !== version.hash) throw new Error(`Damaged checkpoint: ${path}`);
  await mkdir(dirname(absolute), { recursive: true });
  await jailedPath(root, path);
  const temporary = absolute + ".muse-restore-" + randomUUID();
  try {
    await writeFile(temporary, data, { flag: "wx", mode: version.mode });
    await chmod(temporary, version.mode);
    await rename(temporary, absolute);
  } finally { await unlink(temporary).catch(() => undefined); }
}

/** Stored outside the repository; Git index, commits and user stashes are untouched. */
export class TurnCheckpointStore {
  private restoring = false;
  constructor(private readonly storagePath: string) {}

  private directory(workspace: string): string { return join(this.storagePath, hash(Buffer.from(workspace))); }
  private filename(workspace: string, id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid turn checkpoint id.");
    return join(this.directory(workspace), id + ".json");
  }
  private async save(turn: TurnCheckpoint): Promise<void> {
    const file = this.filename(turn.workspace, turn.id);
    await mkdir(dirname(file), { recursive: true });
    const temporary = file + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temporary, JSON.stringify(turn), { flag: "wx", mode: 0o600 });
      await rename(temporary, file);
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  async begin(workspace: string, sessionId: string, prompt: string): Promise<TurnCheckpoint> {
    workspace = await realpath(workspace);
    const turn: TurnCheckpoint = { version: 1, id: randomUUID(), workspace, sessionId, prompt: prompt.slice(0, 200), createdAt: Date.now(), state: "pending", baseline: await capture(workspace), files: [] };
    await this.save(turn);
    return turn;
  }
  async finish(turn: TurnCheckpoint): Promise<TurnCheckpoint> {
    // Repeated close callbacks must never rewrite a completed/undone checkpoint.
    turn = await this.load(turn.workspace, turn.id);
    if (turn.state !== "pending" || !turn.baseline) return turn;
    const after = await capture(turn.workspace, Object.keys(turn.baseline));
    const files: TurnFile[] = [];
    for (const path of new Set([...Object.keys(turn.baseline), ...Object.keys(after)])) {
      const beforeVersion = turn.baseline[path] ?? null;
      const afterVersion = after[path] ?? null;
      if (!same(beforeVersion, afterVersion)) files.push({ path, before: beforeVersion, after: afterVersion });
    }
    const finished: TurnCheckpoint = { ...turn, state: "complete", files };
    delete finished.baseline;
    await this.save(finished);
    return finished;
  }
  async load(workspace: string, id: string): Promise<TurnCheckpoint> {
    workspace = await realpath(workspace);
    const turn = JSON.parse(await readFile(this.filename(workspace, id), "utf8")) as TurnCheckpoint;
    if (turn.version !== 1 || turn.workspace !== workspace || turn.id !== id || !Array.isArray(turn.files)) throw new Error("Invalid turn checkpoint.");
    for (const file of turn.files) {
      await jailedPath(workspace, file.path);
      for (const version of [file.before, file.after]) {
        if (version && (typeof version.data !== "string" || hash(Buffer.from(version.data, "base64")) !== version.hash)) throw new Error("Damaged turn checkpoint.");
      }
    }
    return turn;
  }
  async list(workspace: string, sessionId: string): Promise<TurnCheckpoint[]> {
    workspace = await realpath(workspace);
    let names: string[];
    try { names = await readdir(this.directory(workspace)); } catch (err) { if (missing(err)) return []; throw err; }
    const turns: TurnCheckpoint[] = [];
    for (const name of names.filter((name) => name.endsWith(".json"))) {
      const turn = await this.load(workspace, name.slice(0, -5));
      if (turn.sessionId === sessionId && turn.state !== "pending" && turn.files.length) turns.push(turn);
    }
    return turns.sort((a, b) => a.createdAt - b.createdAt);
  }
  async undo(workspace: string, id: string, dirtyPaths: string[] = []): Promise<TurnCheckpoint> {
    return this.restore(workspace, id, "undo", dirtyPaths);
  }
  async redo(workspace: string, id: string, dirtyPaths: string[] = []): Promise<TurnCheckpoint> {
    return this.restore(workspace, id, "redo", dirtyPaths);
  }
  private async restore(workspace: string, id: string, action: "undo" | "redo", dirtyPaths: string[]): Promise<TurnCheckpoint> {
    if (this.restoring) throw new Error("Another checkpoint restore is still running.");
    this.restoring = true;
    try {
      const turn = await this.load(workspace, id);
      const targetState = action === "undo" ? "undone" : "complete";
      if (turn.state === "pending") throw new Error("This turn has not finished capturing its changes.");
      if (turn.state === targetState) return turn;
      const source = (file: TurnFile) => action === "undo" ? file.after : file.before;
      const target = (file: TurnFile) => action === "undo" ? file.before : file.after;
      const label = action === "undo" ? "Undo" : "Redo";
      // Validate every file before writing any: a conflict leaves the whole turn untouched.
      for (const file of turn.files) {
        if (dirtyPaths.some((path) => resolve(path).toLowerCase() === resolve(turn.workspace, file.path).toLowerCase())) throw new Error(`Save or close the unsaved editor before ${action}: ${file.path}`);
        if (!same(await readVersion(turn.workspace, file.path), source(file))) throw new Error(`${label} blocked: ${file.path} ${action === "undo" ? "changed after this turn" : "changed after undo"}. Your newer edits were preserved.`);
      }
      const restored: TurnFile[] = [];
      try {
        for (const file of turn.files) {
          if (!same(await readVersion(turn.workspace, file.path), source(file))) throw new Error(`File changed during ${action}: ${file.path}`);
          await replaceVersion(turn.workspace, file.path, target(file));
          restored.push(file);
        }
        const updated: TurnCheckpoint = { ...turn, state: targetState };
        await this.save(updated);
        return updated;
      } catch (err) {
        for (const file of restored.reverse()) {
          if (same(await readVersion(turn.workspace, file.path), target(file))) await replaceVersion(turn.workspace, file.path, source(file));
        }
        throw err;
      }
    } finally { this.restoring = false; }
  }
}

export function checkpointText(version: FileVersion | null): string {
  if (!version) return "";
  const data = Buffer.from(version.data, "base64");
  return data.includes(0) ? `[Binary file: ${data.length} bytes; exact bytes retained for undo]` : data.toString("utf8");
}
