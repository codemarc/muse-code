/** Read workspace files for the canvas panel (jailed, size-capped). */

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { kindFromPath, type PreviewKind } from "./previewContent";

export const MAX_CANVAS_FILE_BYTES = 512_000;

export type ReadCanvasFileResult =
  | {
      ok: true;
      source: string;
      kind: PreviewKind;
      filePath: string;
      truncated: boolean;
    }
  | { ok: false; error: string; kind?: PreviewKind; filePath?: string };

/** True if candidate resolves inside workspaceRoot (or equals it). */
export function isUnderWorkspace(
  candidate: string,
  workspaceRoot: string,
): boolean {
  let realRoot = workspaceRoot;
  let realCandidate = candidate;
  try {
    realRoot = realpathSync(workspaceRoot);
  } catch {
    realRoot = resolve(workspaceRoot);
  }
  try {
    realCandidate = existsSync(candidate)
      ? realpathSync(candidate)
      : resolve(candidate);
  } catch {
    realCandidate = resolve(candidate);
  }
  const root = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  return realCandidate === realRoot || realCandidate.startsWith(root);
}

export function readCanvasFile(
  filePath: string,
  workspaceRoot: string,
): ReadCanvasFileResult {
  const kind = kindFromPath(filePath);
  if (!filePath.trim()) {
    return { ok: false, error: "No file path provided." };
  }

  if (!isUnderWorkspace(filePath, workspaceRoot)) {
    return {
      ok: false,
      error: "File is outside the current workspace folder.",
      kind,
      filePath,
    };
  }

  let resolved = filePath;
  try {
    resolved = realpathSync(filePath);
  } catch {
    if (!existsSync(filePath)) {
      return {
        ok: false,
        error: `File not found: ${filePath}`,
        kind,
        filePath,
      };
    }
  }

  if (!isUnderWorkspace(resolved, workspaceRoot)) {
    return {
      ok: false,
      error: "File is outside the current workspace folder.",
      kind,
      filePath: resolved,
    };
  }

  let st;
  try {
    st = lstatSync(resolved);
  } catch {
    return {
      ok: false,
      error: `Cannot read file: ${resolved}`,
      kind,
      filePath: resolved,
    };
  }

  if (!st.isFile()) {
    return {
      ok: false,
      error: "Path is not a regular file.",
      kind,
      filePath: resolved,
    };
  }

  if (kind === "none" && /\.xlsx?$/i.test(resolved)) {
    return {
      ok: false,
      error:
        "Excel files open externally only (no in-canvas spreadsheet preview).",
      kind,
      filePath: resolved,
    };
  }

  if (st.size > MAX_CANVAS_FILE_BYTES) {
    return {
      ok: false,
      error: `File is larger than ${Math.round(MAX_CANVAS_FILE_BYTES / 1024)} KB. Open it externally instead.`,
      kind,
      filePath: resolved,
    };
  }

  try {
    const source = readFileSync(resolved, "utf8");
    return {
      ok: true,
      source,
      kind: kind === "none" ? "text" : kind,
      filePath: resolved,
      truncated: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Could not read file: ${msg}`,
      kind,
      filePath: resolved,
    };
  }
}
