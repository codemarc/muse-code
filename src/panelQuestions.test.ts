import { expect, test } from "bun:test";
import { PanelQuestions, validateQuestionAnswers, type PanelQuestionRequest } from "./panelQuestions";

const request = (): PanelQuestionRequest => ({ userInputId: "input", sessionId: "session", turnId: "turn", itemId: "item", toolCallId: "call", toolName: "request_user_input", viewCursor: "cursor", questions: [
  { id: "language", header: "Language", question: "Which language?", selection: { mode: "single" }, options: [{ label: "TypeScript" }, { label: "JavaScript" }] },
  { id: "checks", header: "Checks", question: "Which checks?", selection: { mode: "multiple", minSelections: 1, maxSelections: 2 }, options: [{ label: "Unit" }, { label: "Integration" }, { label: "Lint" }] },
] });

test("question answers require every id, offered labels and selection bounds", () => {
  const r = request();
  expect(validateQuestionAnswers(r, [{ questionId: "language", selectedLabel: "TypeScript" }, { questionId: "checks", selectedLabels: ["Unit", "Lint"] }])).toHaveLength(2);
  expect(() => validateQuestionAnswers(r, [])).toThrow("every question");
  expect(() => validateQuestionAnswers(r, [{ questionId: "language", selectedLabel: "Rust" }, { questionId: "checks", freeText: "Custom" }])).toThrow("offered");
  expect(() => validateQuestionAnswers(r, [{ questionId: "language", selectedLabel: "TypeScript" }, { questionId: "checks", selectedLabels: ["Unit", "Unit"] }])).toThrow("Choose");
  expect(() => validateQuestionAnswers(r, [{ questionId: "language", selectedLabel: "TypeScript" }, { questionId: "checks", selectedLabels: ["Unit", "Integration", "Lint"] }])).toThrow("Choose");
  expect(() => validateQuestionAnswers(r, [{ questionId: "language", selectedLabel: "TypeScript", freeText: "Custom" }, { questionId: "checks", freeText: "Other" }])).toThrow("Choose options");
});

test("freeform answers and notes obey wire length limits", () => {
  const base = [{ questionId: "language", freeText: "Custom" }, { questionId: "checks", freeText: "Manual", note: "Review this" }];
  expect(validateQuestionAnswers(request(), base)).toEqual(base);
  expect(() => validateQuestionAnswers(request(), [{ ...base[0], freeText: "x".repeat(501) }, base[1]])).toThrow("500");
  expect(() => validateQuestionAnswers(request(), [base[0], { ...base[1], note: "x".repeat(501) }])).toThrow("500");
});

test("question lifecycle rejects stale and duplicate answers, waits for server settlement", async () => {
  let pending = [request()]; let submitted = 0; let release!: () => void;
  const bridge = new PanelQuestions(() => {});
  const dispose = bridge.bind({ fold: { pendingUserInputs: () => pending }, answerUserInput: async () => { submitted++; await new Promise<void>((resolve) => { release = resolve; }); return {}; } } as any);
  try {
    expect(bridge.list()).toHaveLength(1);
    const answer = [{ questionId: "language", freeText: "TS" }, { questionId: "checks", freeText: "Unit" }];
    const sending = bridge.answer("input", answer);
    expect(bridge.list()[0].submitting).toBe(true);
    let duplicate = ""; try { await bridge.answer("input", answer); } catch (error) { duplicate = String(error); }
    expect(duplicate).toContain("already");
    release(); await sending;
    expect(submitted).toBe(1);
    expect(bridge.list()).toHaveLength(1); // ack does not fabricate userInput/settled
    pending = []; bridge.sync();
    let stale = ""; try { await bridge.answer("input", answer); } catch (error) { stale = String(error); }
    expect(stale).toContain("no longer");
    expect(bridge.list()).toHaveLength(0);
  } finally { dispose(); }
});

test("failed submission is retryable and clearing one chat leaves another alone", async () => {
  const a = new PanelQuestions(() => {}); const b = new PanelQuestions(() => {});
  const session = { fold: { pendingUserInputs: () => [request()] }, answerUserInput: async () => { throw new Error("Connection lost"); } } as any;
  const closeA = a.bind(session); const closeB = b.bind(session);
  try {
    try { await a.answer("input", [{ questionId: "language", freeText: "TS" }, { questionId: "checks", freeText: "Unit" }]); } catch {}
    expect(a.list()[0].submitting).toBe(false);
    expect(a.list()[0].error).toBe("Connection lost");
    closeA(); expect(a.list()).toHaveLength(0); expect(b.list()).toHaveLength(1);
  } finally { closeA(); closeB(); }
});

test("late cleanup and reply failure cannot clear a newer question binding", async () => {
  const bridge = new PanelQuestions(() => {}); let release!: () => void;
  const a = { fold: { pendingUserInputs: () => [request()] }, answerUserInput: async () => { await new Promise<void>((resolve) => { release = resolve; }); throw new Error("Old transport closed"); } } as any;
  const b = { fold: { pendingUserInputs: () => [request()] }, answerUserInput: async () => ({}) } as any;
  const closeA = bridge.bind(a);
  const sending = bridge.answer("input", [{ questionId: "language", freeText: "TS" }, { questionId: "checks", freeText: "Unit" }]);
  const closeB = bridge.bind(b);
  try { closeA(); release(); await sending; expect(bridge.list()).toHaveLength(1); expect(bridge.list()[0].error).toBeUndefined(); }
  finally { closeA(); closeB(); }
});
