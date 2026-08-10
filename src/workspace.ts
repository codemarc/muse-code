import { lstatSync, realpathSync } from "node:fs";

export type WorkspaceRootCheck =
  | { ok: true; path: string }
  | { ok: false; error: string };

/** Strip trailing separators so lstat does not dereference a symlink dir. */
export function normalizeWorkspacePath(workspacePath: string): string {
  if (!workspacePath) {
    return workspacePath;
  }
  // Keep a single leading root slash / drive root intact.
  const stripped = workspacePath.replace(/[/\\]+$/, "");
  return stripped || workspacePath;
}

/**
 * Muse Code refuses symlink / reparse-point workspace roots.
 * Detect that before spawning so users get a clear fix instead of opaque stderr.
 */
export function inspectWorkspaceRoot(workspacePath: string): WorkspaceRootCheck {
  const path = normalizeWorkspacePath(workspacePath);
  if (!path) {
    return { ok: false, error: "No workspace folder is open." };
  }

  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) {
      let targetHint = "";
      try {
        targetHint = ` Real path: ${realpathSync(path)}`;
      } catch {
        targetHint = " (symlink target may be missing.)";
      }
      return {
        ok: false,
        error:
          `Workspace root is a symlink.${targetHint} Muse Code rejects symlink / reparse-point roots. Open the real directory (File → Open Folder…).`,
      };
    }
    if (!st.isDirectory()) {
      return {
        ok: false,
        error: `Workspace root is not a directory: ${path}`,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Cannot read workspace root (${path}): ${msg}`,
    };
  }

  return { ok: true, path };
}
