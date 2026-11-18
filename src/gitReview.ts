import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { isUnderWorkspace } from "./canvasFile";

export interface ChangedFile {
  path: string;
  status: string;
}

export interface GitSnapshot {
  files: ChangedFile[];
  diff: string;
  fingerprints?: Record<string, string>;
}

/** Porcelain -z preserves spaces, Unicode and literal arrows in file names. */
export function parsePorcelainZ(text: string): ChangedFile[] {
  const parts = text.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    files.push({ path: entry.slice(3), status: code.trim() || "M" });
    if (/[RC]/.test(code)) i += 1; // -z puts the destination before the source.
  }
  return files;
}

async function fingerprintFile(cwd: string, path: string): Promise<string> {
  const absolute = resolve(cwd, path);
  if (!isUnderWorkspace(absolute, cwd)) return "outside";
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return "not-file";
    // Avoid loading large binaries into the extension host.
    if (info.size > 2_000_000) return `large:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    return createHash("sha256").update(await readFile(absolute)).digest("hex");
  } catch { return "missing"; }
}

const REVIEW_DIFF_MAX = 160_000;

export function parsePorcelain(text: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of text.split("\n")) {
    if (line.length < 4) {
      continue;
    }
    const code = line.slice(0, 2);
    let rest = line.slice(3).trim();
    if (!rest) {
      continue;
    }
    if (rest.startsWith("\"") && rest.endsWith("\"")) {
      rest = rest.slice(1, -1);
    }
    let path = rest;
    let status = code.replace(/ /g, "") || "?";
    if (code.includes("R") && rest.includes(" -> ")) {
      const parts = rest.split(" -> ");
      path = parts[parts.length - 1] ?? rest;
      status = "R";
    } else if (code === "??") {
      status = "??";
    } else {
      status = code.trim() || code[1] || code[0] || "M";
    }
    files.push({ path, status });
  }
  return files;
}

export function filesChangedSince(
  before: ChangedFile[],
  after: ChangedFile[],
): ChangedFile[] {
  const prior = new Map(before.map((file) => [file.path, file.status]));
  return after.filter((file) => prior.get(file.path) !== file.status);
}

export function formatReviewMarkdown(
  files: ChangedFile[],
  diff: string,
): string {
  if (files.length === 0) {
    return "";
  }
  const lines = [
    "# Changed files",
    "",
    "Files changed during this Muse turn. Already written to disk. Git diffs below show the current working tree and may include earlier edits.",
    "",
  ];
  for (const file of files) {
    const label = file.status === "??" ? "untracked" : file.status;
    lines.push(`- \`${file.path}\` (${label})`);
  }
  const body = diff.trim();
  if (body) {
    lines.push("", "```diff", body, "```", "");
  }
  let markdown = lines.join("\n");
  if (markdown.length > REVIEW_DIFF_MAX) {
    markdown =
      markdown.slice(0, REVIEW_DIFF_MAX).trimEnd() + "\n\n…(truncated)\n";
  }
  return markdown;
}

export function runGit(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    try {
      const child = spawn("git", args, {
        cwd,
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.on("error", () => resolve({ ok: false, stdout: "" }));
      child.on("close", (code) => {
        resolve({ ok: code === 0, stdout });
      });
    } catch {
      resolve({ ok: false, stdout: "" });
    }
  });
}

export async function readGitSnapshot(cwd: string): Promise<GitSnapshot> {
  const status = await runGit(cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (!status.ok) {
    return { files: [], diff: "" };
  }
  const files = parsePorcelainZ(status.stdout);
  const fingerprints: Record<string, string> = Object.create(null);
  for (const file of files) fingerprints[file.path] = await fingerprintFile(cwd, file.path);
  const tracked = files.filter((file) => file.status !== "??").map((f) => f.path);
  let diff = "";
  if (tracked.length > 0) {
    const result = await runGit(cwd, ["diff", "--no-color", "--", ...tracked]);
    if (result.ok) {
      diff = result.stdout;
    }
  }
  return { files, diff, fingerprints };
}

export async function reviewSince(
  cwd: string,
  before: GitSnapshot,
): Promise<{ files: ChangedFile[]; markdown: string; diff: string }> {
  const after = await readGitSnapshot(cwd);
  const statusChanges = new Set(filesChangedSince(before.files, after.files).map((file) => file.path));
  const files = after.files.filter((file) => statusChanges.has(file.path) ||
    (before.fingerprints && after.fingerprints && before.fingerprints[file.path] !== after.fingerprints[file.path]));
  for (const file of before.files) {
    if (!after.files.some((next) => next.path === file.path)) {
      const fingerprint = await fingerprintFile(cwd, file.path);
      if (before.fingerprints?.[file.path] !== fingerprint) files.push({ path: file.path, status: fingerprint === "missing" ? "D" : "clean" });
    }
  }
  const tracked = files.filter((file) => file.status !== "??").map((f) => f.path);
  let diff = "";
  if (tracked.length > 0) {
    const result = await runGit(cwd, ["diff", "--no-color", "--", ...tracked]);
    if (result.ok) {
      diff = result.stdout;
    }
  }
  return {
    files,
    diff,
    markdown: formatReviewMarkdown(files, diff),
  };
}
