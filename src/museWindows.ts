/**
 * Windows support for locating the Muse Code binary.
 *
 * On Windows the official installer puts Muse in `%LOCALAPPDATA%\Programs\muse`
 * as a `muse.cmd` shim that runs `.muse-launcher.ps1`, which in turn execs the
 * versioned `muse-bin-<version>.exe` named in `.muse-version`.
 *
 * Node refuses to spawn `.cmd`/`.bat` files without `shell: true`, and running
 * the prompt through cmd.exe would reintroduce shell quoting/injection issues.
 * So we resolve straight to the signed `.exe` and spawn it with `shell: false`.
 * (The PowerShell launcher's hourly self-update still happens whenever the user
 * runs `muse` from a terminal.)
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { win32 } from "node:path";

export interface WindowsResolveDeps {
  env: NodeJS.ProcessEnv;
  fileExists: (p: string) => boolean;
  readText: (p: string) => string | null;
}

export const defaultWindowsResolveDeps: WindowsResolveDeps = {
  env: process.env,
  fileExists: (p) => {
    try {
      return existsSync(p) && statSync(p).isFile();
    } catch {
      return false;
    }
  },
  readText: (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
};

const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+-R[0-9]+(\.[0-9]+)?$/;

/** Shim/launcher files that cannot be spawned directly without a shell. */
export function isWindowsShimPath(p: string): boolean {
  return /\.(cmd|bat|ps1)$/i.test(p);
}

/**
 * Given a Muse install directory, return the versioned binary named by
 * `.muse-version`, or null when the directory is not a Muse install.
 */
export function museExeInInstallDir(
  installDir: string,
  deps: WindowsResolveDeps = defaultWindowsResolveDeps,
): string | null {
  const raw = deps.readText(win32.join(installDir, ".muse-version"));
  const version = raw?.trim();
  if (!version || !VERSION_RE.test(version)) {
    return null;
  }
  const exe = win32.join(installDir, `muse-bin-${version}.exe`);
  return deps.fileExists(exe) ? exe : null;
}

/** Default per-user install location used by the official Windows installer. */
export function defaultWindowsInstallDir(env: NodeJS.ProcessEnv): string | null {
  const local = env.LOCALAPPDATA?.trim();
  return local ? win32.join(local, "Programs", "muse") : null;
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  // Windows env lookups are case-insensitive; process.env handles that, but a
  // plain object passed in tests may use `Path`.
  const raw = env.PATH ?? env.Path ?? "";
  return raw
    .split(";")
    .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

export type WindowsResolveResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Resolve the bare `muse` command on Windows:
 * 1. the official install dir (`%LOCALAPPDATA%\Programs\muse`),
 * 2. any PATH directory that is a Muse install (has `.muse-version`),
 * 3. a plain `muse.exe` on PATH.
 */
export function resolveWindowsMuseCommand(
  deps: WindowsResolveDeps = defaultWindowsResolveDeps,
): WindowsResolveResult {
  const installDir = defaultWindowsInstallDir(deps.env);
  if (installDir) {
    const exe = museExeInInstallDir(installDir, deps);
    if (exe) {
      return { ok: true, path: exe };
    }
  }

  for (const dir of pathEntries(deps.env)) {
    const exe = museExeInInstallDir(dir, deps);
    if (exe) {
      return { ok: true, path: exe };
    }
    const plain = win32.join(dir, "muse.exe");
    if (deps.fileExists(plain)) {
      return { ok: true, path: plain };
    }
  }

  return {
    ok: false,
    error:
      "Muse Code was not found. Install it, or set muse.executablePath to the muse-bin-<version>.exe in %LOCALAPPDATA%\\Programs\\muse.",
  };
}

/**
 * A configured path pointing at the `muse.cmd` / launcher shim is mapped to the
 * versioned `.exe` next to it, so users can paste the path `where muse` prints.
 */
export function resolveWindowsShimPath(
  shimPath: string,
  deps: WindowsResolveDeps = defaultWindowsResolveDeps,
): WindowsResolveResult {
  const exe = museExeInInstallDir(win32.dirname(shimPath), deps);
  if (exe) {
    return { ok: true, path: exe };
  }
  return {
    ok: false,
    error: `${win32.basename(shimPath)} is a launcher script and cannot be run directly. Point muse.executablePath at the muse-bin-<version>.exe next to it.`,
  };
}
