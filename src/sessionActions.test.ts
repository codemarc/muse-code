import { expect, test } from "bun:test";
import { branchResult, validateSessionName } from "./sessionActions";

test("a branch must be a distinct valid server session, never a guessed id or source replay", () => {
  const source = "01a1d11b-945f-7000-ad8d-723cd8a0944a";
  const child = "00000000-0000-7808-b67a-82b214312279";
  expect(branchResult(source, { session: { sessionId: child, name: "Branch" } })).toEqual({ sessionId: child, name: "Branch" });
  expect(() => branchResult(source, { session: { sessionId: source } })).toThrow();
  expect(() => branchResult(source, {})).toThrow();
  expect(() => branchResult(source, { session: { sessionId: "../../other" } })).toThrow();
});

test("conversation names accept Unicode and reject empty, oversized and control text", () => {
  expect(validateSessionName("  Muse · ödeme akışı  ")).toBeUndefined();
  expect(validateSessionName(" ")).toBeTruthy();
  expect(validateSessionName("x".repeat(121))).toBeTruthy();
  expect(validateSessionName("a\nb")).toBeTruthy();
  expect(validateSessionName("a\u0000b")).toBeTruthy();
});
