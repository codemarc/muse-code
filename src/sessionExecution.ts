import { open } from "node:fs/promises";
import type { ExecutionMode } from "./executionMode";

export type SessionApprovalPolicy = "interactive" | "headless" | "unknown";

/** Durable reconfiguration takes precedence over exec's per-run security banner.
 * Muse can emit approval=disabled while retaining an earlier MSP session policy.
 */
export function sessionApprovalPolicy(jsonl: string): SessionApprovalPolicy {
  let configured: SessionApprovalPolicy | undefined;
  let startup: SessionApprovalPolicy = "unknown";
  for (const line of jsonl.split("\n")) {
    if (!line.includes('"runtime.approval_reconfigure"') && !line.includes('"security_mode"')) continue;
    try {
      const record = JSON.parse(line);
      if (record.payload_type === "runtime.approval_reconfigure") {
        const change = record.payload?.record;
        if (change?.apply_outcome !== "completed" && change?.apply_outcome !== "noop") continue;
        configured = change.effective_mode === "allow_all" ? "headless"
          : ["prompt_unmatched", "on_request", "deny_unmatched"].includes(change.effective_mode) ? "interactive" : "unknown";
      } else if (record.payload_type === "runtime.session" && record.payload?.kind === "security_mode") {
        startup = record.payload.event?.approval === "disabled" ? "headless" : "unknown";
      }
    } catch {
      if (line.includes('"runtime.approval_reconfigure"')) configured = "unknown";
    }
  }
  return configured ?? startup;
}

/** Bounded local inspection only: never start a host or reconfigure permissions. */
export async function readSessionApprovalPolicy(path: string | null): Promise<SessionApprovalPolicy> {
  if (!path) return "unknown";
  let file;
  try {
    file = await open(path, "r");
    const info = await file.stat();
    const size = info.size;
    if (!info.isFile()) return "unknown";
    if (size > 32 * 1024 * 1024) return "unknown";
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await file.read(buffer, offset, size - offset, offset);
      if (!bytesRead) return "unknown";
      offset += bytesRead;
    }
    if ((await file.stat()).size !== size) return "unknown";
    return sessionApprovalPolicy(buffer.toString("utf8"));
  } catch { return "unknown"; }
  finally { await file?.close().catch(() => {}); }
}

export function needsApprovalCapableMode(mode: ExecutionMode, policy: SessionApprovalPolicy): boolean {
  return (mode === "headless" || mode === "windows") && policy !== "headless";
}

/** Respect an existing workspace override when a user changes the mode in chat. */
export function executionModeTarget(inspected: { workspaceFolderValue?: unknown; workspaceValue?: unknown } | undefined): "folder" | "workspace" | "global" {
  return inspected?.workspaceFolderValue !== undefined ? "folder"
    : inspected?.workspaceValue !== undefined ? "workspace" : "global";
}
