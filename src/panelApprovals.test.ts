import { expect, test } from "bun:test";
import { PanelApprovals, type PanelApproval } from "./panelApprovals";

const request = (id = "approval", stage = 0): PanelApproval => ({
  approvalId: id, currentRequirementId: { approvalId: id, sourceIndex: stage },
  availableChoices: [
    { choiceId: "once", label: "Allow once", decision: "approved", scope: "once" },
    { choiceId: "reject", label: "Reject", decision: "abort", scope: "once", acceptsFeedback: true },
  ], sessionId: "session", turnId: "turn", toolName: "write_file", rawArgs: "{}",
  subject: { kind: "fileAccess" }, itemId: "item", taskId: "task", toolCallId: "call",
  protectedWrite: true, judgeEscalated: false, viewCursor: "cursor", sourceRange: {} as any,
});

test("approval waits for an explicit offered choice and rejects stale stages", async () => {
  const approvals = new PanelApprovals(() => {});
  const decision = approvals.request(request());
  expect(approvals.list()).toHaveLength(1);
  expect(() => approvals.decide("approval", 1, "once")).toThrow("changed");
  expect(() => approvals.decide("approval", 0, "invented")).toThrow("offered");
  expect(() => approvals.decide("approval", 0, "once", "feedback")).toThrow("feedback");
  expect(approvals.list()).toHaveLength(1);
  approvals.decide("approval", 0, "reject", "Use a different file");
  expect(await decision).toEqual({ choiceId: "reject", feedback: "Use a different file" });
  expect(approvals.list()).toHaveLength(0);
  expect(() => approvals.decide("approval", 0, "once")).toThrow("changed");
});

test("approval queues and cancellation are independent between chats", async () => {
  const first = new PanelApprovals(() => {});
  const second = new PanelApprovals(() => {});
  const pendingA = first.request(request());
  const rejected = Promise.resolve(pendingA).catch((error) => error.message);
  const pendingB = second.request(request());
  first.clear();
  expect(await rejected).toBe("Turn ended.");
  expect(second.list()).toHaveLength(1);
  second.decide("approval", 0, "once");
  expect(await pendingB).toEqual({ choiceId: "once" });
});

test("an updated requirement replaces the displayed stage", async () => {
  const approvals = new PanelApprovals(() => {});
  const old = approvals.request(request());
  const rejected = Promise.resolve(old).catch((error) => error.message);
  const current = approvals.request(request("approval", 1));
  expect(await rejected).toBe("Approval stage superseded.");
  expect(() => approvals.decide("approval", 0, "once")).toThrow("changed");
  approvals.decide("approval", 1, "once");
  expect(await current).toEqual({ choiceId: "once" });
});
