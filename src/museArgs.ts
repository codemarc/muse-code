import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  defaultWindowsResolveDeps,
  isWindowsShimPath,
  resolveWindowsMuseCommand,
  resolveWindowsShimPath,
  type WindowsResolveDeps,
} from "./museWindows";

export interface MuseSettings {
  executablePath: string;
  model: string;
  reasoningEffort: string;
  trustWorkspace: boolean;
  disableApproval: boolean;
  yolo: boolean;
  useEchoProvider: boolean;
  extraArgs: string[];
}

export type ResolveBinaryResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/** Flags that must not be smuggled through muse.extraArgs. */
const BLOCKED_EXTRA_FLAGS = new Set([
  "--yolo",
  "--disable-sandbox",
  "--no-sandbox",
]);

/**
 * Resolve the Muse binary.
 * - `"muse"` (default): leave to PATH (no silent ~/.local preference).
 * - Absolute or relative path: must exist and be a regular file.
 * - Other bare names are rejected (prevents accidental / malicious aliases).
 * - Windows: `"muse"` and paths to the `muse.cmd` launcher shim resolve to the
 *   versioned `muse-bin-<version>.exe`, since `.cmd` files cannot be spawned
 *   with `shell: false` (see museWindows.ts).
 */
export function resolveMuseBinary(
  configured: string,
  platform: NodeJS.Platform = process.platform,
  windowsDeps: WindowsResolveDeps = defaultWindowsResolveDeps,
): ResolveBinaryResult {
  const trimmed = (configured || "muse").trim();
  if (!trimmed) {
    return { ok: false, error: "muse.executablePath is empty." };
  }
  if (/[\0\n\r]/.test(trimmed)) {
    return {
      ok: false,
      error: "muse.executablePath contains invalid control characters.",
    };
  }

  const looksLikePath =
    isAbsolute(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.startsWith(".");

  if (looksLikePath) {
    if (!existsSync(trimmed)) {
      return {
        ok: false,
        error: `Muse binary not found at ${trimmed}. Set muse.executablePath to a real file, or use "muse" on PATH.`,
      };
    }
    try {
      if (!statSync(trimmed).isFile()) {
        return {
          ok: false,
          error: `muse.executablePath is not a file: ${trimmed}`,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Cannot stat muse.executablePath: ${msg}` };
    }
    if (platform === "win32" && isWindowsShimPath(trimmed)) {
      return resolveWindowsShimPath(trimmed, windowsDeps);
    }
    return { ok: true, path: trimmed };
  }

  if (trimmed !== "muse") {
    return {
      ok: false,
      error: `muse.executablePath must be "muse" or a filesystem path to the binary (got "${trimmed}").`,
    };
  }

  if (platform === "win32") {
    return resolveWindowsMuseCommand(windowsDeps);
  }

  return { ok: true, path: "muse" };
}

export function sanitizeExtraArgs(extraArgs: string[] | undefined): {
  allowed: string[];
  rejected: string[];
} {
  const allowed: string[] = [];
  const rejected: string[] = [];
  for (const raw of extraArgs ?? []) {
    const arg = String(raw);
    if (!arg || /[\0\n\r]/.test(arg)) {
      rejected.push(arg);
      continue;
    }
    const flag = arg.split("=")[0] ?? arg;
    if (BLOCKED_EXTRA_FLAGS.has(flag)) {
      rejected.push(arg);
      continue;
    }
    allowed.push(arg);
  }
  return { allowed, rejected };
}

/** Provider a run uses; a session must keep using the provider it started with. */
export function museProviderId(settings: Pick<MuseSettings, "useEchoProvider">): "echo" | "meta" {
  return settings.useEchoProvider ? "echo" : "meta";
}

export function buildMuseExecArgs(
  settings: MuseSettings,
  opts: { prompt: string; workspacePath: string; sessionId: string; windowsShell?: boolean },
): { args: string[]; rejectedExtraArgs: string[] } {
  if (opts.windowsShell && settings.yolo) throw new Error("Turn off muse.yolo before using sandboxed Windows compatibility mode.");
  const args = [
    "exec",
    "--json",
    "--workspace",
    opts.workspacePath,
    "--session-id",
    opts.sessionId,
  ];

  // MSP stores a normal Windows path while exec canonicalizes it with \\?\.
  // The workspace is selected and validated by the host before this call.
  // Windows reminder probes can leave an internal read-worker refreshing
  // profile ACLs after exec exits and block the next sandbox admission.
  if (opts.windowsShell) args.push("--enable-shell-tool", "--allow-workspace-switch", "--disable-reminders");

  if (settings.yolo) {
    args.push("--yolo");
  } else {
    if (settings.trustWorkspace) {
      args.push("--trust-workspace");
    }
    if (settings.disableApproval) {
      args.push("--disable-approval");
    }
  }

  // Always name the provider: a Muse session keeps the provider it was created
  // with, so leaving it implicit silently reuses echo after echo is turned off.
  args.push("--provider", museProviderId(settings));
  if (!settings.useEchoProvider) {
    // Echo rejects --model / --reasoning-effort and exits without a reply.
    if (settings.model.trim()) {
      args.push("--model", settings.model.trim());
    }
    if (settings.reasoningEffort.trim()) {
      args.push("--reasoning-effort", settings.reasoningEffort.trim());
    }
  }

  const { allowed, rejected } = sanitizeExtraArgs(settings.extraArgs);
  if (allowed.length) {
    args.push(...allowed);
  }

  // "--" ends option parsing, so a prompt such as "--yolo …" stays a prompt.
  args.push("--", opts.prompt);
  return { args, rejectedExtraArgs: rejected };
}
