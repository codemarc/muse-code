import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sessionApprovalPolicy, needsApprovalCapableMode, executionModeTarget, isWindowsPanelSandboxFailure, readSessionApprovalPolicy } from "./sessionExecution";

test("offers Windows recovery only for a failed shell tool with the Muse sandbox error", () => {
  const resultRaw = "tool failed: environment failure: sandbox enforcement unavailable: windows_elevated setup_required: windows elevated sandbox setup has not run";
  const event = { kind: "tool", name: "powershell", status: "failed", resultRaw, resultView: null } as const;
  expect(isWindowsPanelSandboxFailure(event)).toBe(true);
  expect(isWindowsPanelSandboxFailure({ ...event, status: "completed" })).toBe(false);
  expect(isWindowsPanelSandboxFailure({ ...event, name: "read_file" })).toBe(false);
  expect(isWindowsPanelSandboxFailure({ ...event, resultRaw: "PowerShell exited with code 7" })).toBe(false);
  expect(isWindowsPanelSandboxFailure({ kind: "assistant_final", text: resultRaw, terminal: "completed" })).toBe(false);
});

const flag = JSON.stringify({ payload_type: "runtime.session", payload: { kind: "security_mode", event: { approval: "disabled", sandbox: "normal" } } });
const policy = (mode: string, outcome = "completed") => JSON.stringify({ payload_type: "runtime.approval_reconfigure", payload: { record: { effective_mode: mode, apply_outcome: outcome } } });

test("Panel policy survives misleading per-run exec disable-approval banner", () => {
  const log = [flag, policy("prompt_unmatched"), flag].join("\n");
  expect(sessionApprovalPolicy(log)).toBe("interactive");
  expect(needsApprovalCapableMode("windows", sessionApprovalPolicy(log))).toBe(true);
  expect(needsApprovalCapableMode("headless", sessionApprovalPolicy(log))).toBe(true);
  expect(needsApprovalCapableMode("panel", sessionApprovalPolicy(log))).toBe(false);
  expect(needsApprovalCapableMode("interactive", sessionApprovalPolicy(log))).toBe(false);
});

test("only completed or noop policy changes affect session routing", () => {
  expect(sessionApprovalPolicy(flag)).toBe("headless");
  expect(sessionApprovalPolicy([policy("prompt_unmatched"), policy("allow_all", "rejected"), flag].join("\n"))).toBe("interactive");
  expect(sessionApprovalPolicy([policy("prompt_unmatched"), policy("allow_all")].join("\n"))).toBe("headless");
  expect(sessionApprovalPolicy(policy("prompt_unmatched", "noop"))).toBe("interactive");
  expect(sessionApprovalPolicy([flag, policy("future_policy")].join("\n"))).toBe("unknown");
  expect(sessionApprovalPolicy('{"security_mode":')).toBe("unknown");
  expect(sessionApprovalPolicy([flag, '{"payload_type":"runtime.approval_reconfigure",'].join("\n"))).toBe("unknown");
  expect(needsApprovalCapableMode("windows", "unknown")).toBe(true);
});

test("missing session evidence cannot silently admit an existing session to exec", async () => {
  expect(await readSessionApprovalPolicy(null)).toBe("unknown");
  expect(await readSessionApprovalPolicy("missing-session-evidence.jsonl")).toBe("unknown");
});

test("mode picker updates the effective scope instead of a shadowed user setting", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(manifest.contributes.configuration.properties["muse.executionMode"].scope).toBe("resource");
  expect(executionModeTarget(undefined)).toBe("global");
  expect(executionModeTarget({ workspaceValue: "windows" })).toBe("workspace");
  expect(executionModeTarget({ workspaceFolderValue: "panel", workspaceValue: "windows" })).toBe("folder");
});
