import { expect, test } from "bun:test";
import { WorkspaceLease } from "./workspaceLease";

test("prevents overlapping checkpoints in one folder and permits different roots", () => {
  const leases = new WorkspaceLease();
  const releaseA = leases.acquire("fixture-a");
  expect(() => leases.acquire("fixture-a/.")).toThrow("Another Muse chat");
  expect(() => leases.acquire("fixture-a/nested")).toThrow("Another Muse chat");
  const releaseB = leases.acquire("fixture-b");
  releaseA();
  const releaseNext = leases.acquire("fixture-a");
  releaseA(); // An old cleanup must not release the next owner's lease.
  expect(() => leases.acquire("fixture-a")).toThrow();
  releaseNext(); releaseB();
});
