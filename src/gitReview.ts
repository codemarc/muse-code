import { spawn } from "node:child_process";

export interface ChangedFile {
  path: string;
  status: string;
}

export interface GitSnapshot {
  files: ChangedFile[];
  diff: string;
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
    "Working-tree changes since this Muse turn started. Already written to disk.",
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
    "--porcelain",
    "--untracked-files=normal",
  ]);
  if (!status.ok) {
    return { files: [], diff: "" };
  }
  const files = parsePorcelain(status.stdout);
  const tracked = files.filter((file) => file.status !== "??").map((f) => f.path);
  let diff = "";
  if (tracked.length > 0) {
    const result = await runGit(cwd, ["diff", "--no-color", "--", ...tracked]);
    if (result.ok) {
      diff = result.stdout;
    }
  }
  return { files, diff };
}

export async function reviewSince(
  cwd: string,
  before: GitSnapshot,
): Promise<{ files: ChangedFile[]; markdown: string; diff: string }> {
  const after = await readGitSnapshot(cwd);
  const files = filesChangedSince(before.files, after.files);
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
