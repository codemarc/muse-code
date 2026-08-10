import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { resolveMuseBinary } from "./museArgs";
import { readMuseSettings } from "./museCli";
import {
  transcriptFromExportJson,
  transcriptFromSessionLogPath,
} from "./museHistory";
import type { TranscriptItem } from "./transcript";

/** Prefer local session.jsonl (fast); fall back to `muse export`. */
export async function loadSessionTranscript(opts: {
  sessionId: string;
  workspacePath: string;
  sessionLogPath?: string | null;
}): Promise<{ items: TranscriptItem[]; source: "jsonl" | "export" | "empty" }> {
  if (opts.sessionLogPath) {
    try {
      const items = transcriptFromSessionLogPath(opts.sessionLogPath);
      if (items.length) {
        return { items, source: "jsonl" };
      }
    } catch {
      // fall through to export
    }
  }

  try {
    const items = await exportSessionTranscript(
      opts.sessionId,
      opts.workspacePath,
    );
    return { items, source: items.length ? "export" : "empty" };
  } catch {
    return { items: [], source: "empty" };
  }
}

export async function exportSessionTranscript(
  sessionId: string,
  workspacePath: string,
): Promise<TranscriptItem[]> {
  const settings = readMuseSettings();
  const resolved = resolveMuseBinary(settings.executablePath);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const dir = await mkdtemp(join(tmpdir(), "muse-cli-chat-export-"));
  const outPath = join(dir, "session.json");
  try {
    await runMuseExport(resolved.path, sessionId, outPath, workspacePath);
    const raw = await readFile(outPath, "utf8");
    return transcriptFromExportJson(raw);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runMuseExport(
  bin: string,
  sessionId: string,
  outPath: string,
  workspacePath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      ["export", "--session", sessionId, "--out", outPath],
      {
        cwd: workspacePath,
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let err = "";
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(err.trim() || `muse export exited ${code}`));
    });
  });
}
