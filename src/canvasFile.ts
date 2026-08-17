/** Read files for the canvas panel (root-jailed, size-capped). */

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { kindFromPath, type PreviewKind } from "./previewContent";

export const MAX_CANVAS_FILE_BYTES = 512_000;

/** Why a file cannot render in the canvas; callers use this to pick a fallback. */
export type CanvasFileReason =
  | "empty-path"
  | "outside"
  | "missing"
  | "not-file"
  | "too-large"
  | "binary"
  | "read-error";

export type ReadCanvasFileResult =
  | {
      ok: true;
      source: string;
      kind: PreviewKind;
      filePath: string;
      truncated: boolean;
    }
  | {
      ok: false;
      reason: CanvasFileReason;
      error: string;
      kind?: PreviewKind;
      filePath?: string;
    };

function realOrResolved(p: string): string {
  try {
    return existsSync(p) ? realpathSync(p) : resolve(p);
  } catch {
    return resolve(p);
  }
}

/** True if candidate resolves inside root (or equals it). */
export function isUnderWorkspace(candidate: string, root: string): boolean {
  const realRoot = realOrResolved(root);
  const realCandidate = realOrResolved(candidate);
  const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  return realCandidate === realRoot || realCandidate.startsWith(prefix);
}

/** True if candidate resolves inside any of the given roots. */
export function isUnderAnyRoot(candidate: string, roots: string[]): boolean {
  return roots.some((root) => root && isUnderWorkspace(candidate, root));
}

export function readCanvasFile(
  filePath: string,
  roots: string | string[],
): ReadCanvasFileResult {
  const allowed = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
  const kind = kindFromPath(filePath);
  const isSpreadsheet = /\.xlsx?$/i.test(filePath);

  if (!filePath.trim()) {
    return { ok: false, reason: "empty-path", error: "No file path provided." };
  }

  if (!existsSync(filePath)) {
    return {
      ok: false,
      reason: "missing",
      error: `File not found: ${filePath}`,
      kind,
      filePath,
    };
  }

  let resolved = filePath;
  try {
    resolved = realpathSync(filePath);
  } catch {
    resolved = resolve(filePath);
  }

  if (!isUnderAnyRoot(resolved, allowed)) {
    return {
      ok: false,
      reason: "outside",
      error: "File is outside the workspace and Muse data folders.",
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
      reason: "read-error",
      error: `Cannot read file: ${resolved}`,
      kind,
      filePath: resolved,
    };
  }

  if (!st.isFile()) {
    return {
      ok: false,
      reason: "not-file",
      error: "Path is not a regular file.",
      kind,
      filePath: resolved,
    };
  }

  if (isSpreadsheet) {
    return {
      ok: false,
      reason: "binary",
      error: "Spreadsheets have no in-canvas preview.",
      kind,
      filePath: resolved,
    };
  }

  if (st.size > MAX_CANVAS_FILE_BYTES) {
    return {
      ok: false,
      reason: "too-large",
      error: `File is larger than ${Math.round(MAX_CANVAS_FILE_BYTES / 1024)} KB.`,
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
      reason: "read-error",
      error: `Could not read file: ${msg}`,
      kind,
      filePath: resolved,
    };
  }
}
