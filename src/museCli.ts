import { spawn, type ChildProcess } from "node:child_process";
import * as vscode from "vscode";
import {
  buildMuseExecArgs,
  resolveMuseBinary,
  type MuseSettings,
  type ResolveBinaryResult,
} from "./museArgs";
import {
  JsonlLineBuffer,
  processJsonlChunk,
  type MuseUiEvent,
} from "./museJsonl";

export type { MuseSettings, ResolveBinaryResult };
export { buildMuseExecArgs, resolveMuseBinary, sanitizeExtraArgs } from "./museArgs";

export interface MuseRunOptions {
  windowsShell?: boolean;
  prompt: string;
  workspacePath: string;
  sessionId: string;
  onEvent: (event: MuseUiEvent) => void;
  onStderr?: (text: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onRejectedExtraArgs?: (rejected: string[]) => void;
}

export interface MuseRunHandle {
  child?: ChildProcess;
  settled?: Promise<void>;
  stop: () => void;
}

/**
 * `child.kill()` on Windows calls TerminateProcess on muse only, orphaning the
 * shells/dev servers it started. `taskkill /T` ends the whole tree.
 */
function killWindowsProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) {
    return;
  }
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const killer = spawn(
    `${systemRoot}\\System32\\taskkill.exe`,
    ["/PID", String(child.pid), "/T", "/F"],
    { stdio: "ignore", shell: false, windowsHide: true },
  );
  killer.on("error", () => {
    child.kill();
  });
}

export function readMuseSettings(): MuseSettings {
  const cfg = vscode.workspace.getConfiguration("muse");
  return {
    executablePath: cfg.get<string>("executablePath", "muse"),
    model: cfg.get<string>("model", ""),
    reasoningEffort: cfg.get<string>("reasoningEffort", ""),
    trustWorkspace: cfg.get<boolean>("trustWorkspace", true),
    disableApproval: cfg.get<boolean>("disableApproval", false),
    yolo: cfg.get<boolean>("yolo", false),
    useEchoProvider: cfg.get<boolean>("useEchoProvider", false),
    extraArgs: cfg.get<string[]>("extraArgs", []),
  };
}

export async function checkMuseInstallation(): Promise<string> {
  const settings = readMuseSettings();
  const resolved = resolveMuseBinary(settings.executablePath);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
  const bin = resolved.path;
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, ["--version"], {
      env: process.env,
      shell: false,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) {
        resolve((out || err).trim() || bin);
      } else {
        reject(new Error(err.trim() || `muse --version exited ${code}`));
      }
    });
  });
}

export function startMuseExec(opts: MuseRunOptions): MuseRunHandle {
  const settings = readMuseSettings();
  const resolved = resolveMuseBinary(settings.executablePath);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const { args, rejectedExtraArgs } = buildMuseExecArgs(settings, {
    prompt: opts.prompt,
    workspacePath: opts.workspacePath,
    sessionId: opts.sessionId,
    windowsShell: opts.windowsShell,
  });
  if (rejectedExtraArgs.length) {
    opts.onRejectedExtraArgs?.(rejectedExtraArgs);
  }

  const child = spawn(resolved.path, args, {
    cwd: opts.workspacePath,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  const buffer = new JsonlLineBuffer();

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk: string) => {
    for (const event of processJsonlChunk(buffer, chunk)) {
      opts.onEvent(event);
    }
  });

  child.stderr.on("data", (chunk: string) => {
    opts.onStderr?.(chunk);
  });

  let exited = false;
  const finish = (code: number | null, signal: NodeJS.Signals | null) => {
    if (exited) return;
    exited = true;
    opts.onExit?.(code, signal);
  };

  child.on("error", (err) => {
    opts.onEvent({
      kind: "parse_error",
      line: "",
      error: `Failed to start muse: ${err.message}`,
    });
    finish(null, null);
  });

  let stopRequested = false;

  child.on("close", (code, signal) => {
    const rest = buffer.flush();
    if (rest) {
      for (const event of processJsonlChunk(buffer, rest + "\n")) {
        opts.onEvent(event);
      }
    }
    // Windows has no signals: a stopped process just exits with a code, so
    // report the stop the way POSIX callers already expect.
    finish(code, signal ?? (stopRequested ? "SIGTERM" : null));
  });

  return {
    child,
    stop: () => {
      stopRequested = true;
      if (process.platform === "win32") {
        killWindowsProcessTree(child);
        return;
      }
      if (!child.killed) {
        child.kill("SIGINT");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGTERM");
          }
        }, 2000);
      }
    },
  };
}
