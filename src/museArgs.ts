import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

export function resolveMuseBinary(configured: string): string {
  if (configured && configured !== "muse" && existsSync(configured)) {
    return configured;
  }
  const local = join(homedir(), ".local", "bin", "muse");
  if (existsSync(local)) {
    return local;
  }
  return configured || "muse";
}

export function buildMuseExecArgs(
  settings: MuseSettings,
  opts: { prompt: string; workspacePath: string; sessionId: string },
): string[] {
  const args = [
    "exec",
    "--json",
    "--workspace",
    opts.workspacePath,
    "--session-id",
    opts.sessionId,
  ];

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

  if (settings.useEchoProvider) {
    args.push("--provider", "echo");
  }
  if (settings.model.trim()) {
    args.push("--model", settings.model.trim());
  }
  if (settings.reasoningEffort.trim()) {
    args.push("--reasoning-effort", settings.reasoningEffort.trim());
  }
  if (settings.extraArgs?.length) {
    args.push(...settings.extraArgs);
  }

  args.push(opts.prompt);
  return args;
}
