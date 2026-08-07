import { spawn, type ChildProcess } from "node:child_process";
import * as vscode from "vscode";
import {
  buildMuseExecArgs,
  resolveMuseBinary,
  type MuseSettings,
} from "./museArgs";
import {
  JsonlLineBuffer,
  processJsonlChunk,
  type MuseUiEvent,
} from "./museJsonl";

export type { MuseSettings };
export { buildMuseExecArgs, resolveMuseBinary };

export interface MuseRunOptions {
  prompt: string;
  workspacePath: string;
  sessionId: string;
  onEvent: (event: MuseUiEvent) => void;
  onStderr?: (text: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export interface MuseRunHandle {
  child: ChildProcess;
  stop: () => void;
}

export function readMuseSettings(): MuseSettings {
  const cfg = vscode.workspace.getConfiguration("muse");
  return {
    executablePath: cfg.get<string>("executablePath", "muse"),
    model: cfg.get<string>("model", ""),
    reasoningEffort: cfg.get<string>("reasoningEffort", ""),
    trustWorkspace: cfg.get<boolean>("trustWorkspace", true),
    disableApproval: cfg.get<boolean>("disableApproval", true),
    yolo: cfg.get<boolean>("yolo", false),
    useEchoProvider: cfg.get<boolean>("useEchoProvider", false),
    extraArgs: cfg.get<string[]>("extraArgs", []),
  };
}

export async function checkMuseInstallation(): Promise<string> {
  const settings = readMuseSettings();
  const bin = resolveMuseBinary(settings.executablePath);
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, ["--version"], { env: process.env });
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
  const bin = resolveMuseBinary(settings.executablePath);
  const args = buildMuseExecArgs(settings, {
    prompt: opts.prompt,
    workspacePath: opts.workspacePath,
    sessionId: opts.sessionId,
  });

  const child = spawn(bin, args, {
    cwd: opts.workspacePath,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
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

  child.on("error", (err) => {
    opts.onEvent({
      kind: "parse_error",
      line: "",
      error: `Failed to start muse: ${err.message}`,
    });
    opts.onExit?.(null, null);
  });

  child.on("close", (code, signal) => {
    const rest = buffer.flush();
    if (rest) {
      for (const event of processJsonlChunk(buffer, rest + "\n")) {
        opts.onEvent(event);
      }
    }
    opts.onExit?.(code, signal);
  });

  return {
    child,
    stop: () => {
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
