import type { Session } from "@muse-code/sdk";

export type PanelQuestionRequest = ReturnType<Session["fold"]["pendingUserInputs"]>[number];
export type PanelQuestionAnswer = Parameters<Session["answerUserInput"]>[1][number];
export type PanelQuestionCard = PanelQuestionRequest & { submitting: boolean; error?: string };

/** Poll the SDK's folded state without replacing its single notification handler. */
export class PanelQuestions {
  private session?: Pick<Session, "fold" | "answerUserInput">;
  private timer?: NodeJS.Timeout;
  private pending = new Map<string, PanelQuestionCard>();
  private fingerprint = "";
  constructor(private readonly changed: (requests: PanelQuestionCard[]) => void) {}

  bind(session: Pick<Session, "fold" | "answerUserInput">): () => void {
    this.clear();
    this.session = session;
    this.sync();
    this.timer = setInterval(() => this.sync(), 200);
    return () => { if (this.session === session) this.clear(); };
  }

  sync(): void {
    const requests = this.session?.fold.pendingUserInputs() ?? [];
    this.pending = new Map(requests.map((request) => {
      const previous = this.pending.get(request.userInputId);
      return [request.userInputId, { ...request, submitting: previous?.submitting ?? false, error: previous?.error }];
    }));
    this.publish();
  }

  list(): PanelQuestionCard[] { return [...this.pending.values()]; }

  async answer(id: string, raw: unknown): Promise<void> {
    this.sync();
    const session = this.session;
    const card = this.pending.get(id);
    if (!session || !card) throw new Error("This question is no longer pending.");
    if (card.submitting) throw new Error("Your answer is already being sent.");
    const answers = validateQuestionAnswers(card, raw);
    card.submitting = true;
    card.error = undefined;
    this.publish();
    try {
      await session.answerUserInput(id, answers);
      if (this.session === session) this.sync();
    } catch (error) {
      if (this.session !== session) return;
      if (this.session === session && this.pending.has(id)) {
        this.pending.get(id)!.submitting = false;
        this.pending.get(id)!.error = error instanceof Error ? error.message : String(error);
        this.publish();
      }
      throw error;
    }
  }

  clear(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.session = undefined;
    this.pending.clear();
    this.publish();
  }

  private publish(): void {
    const cards = this.list();
    const next = JSON.stringify(cards);
    if (next !== this.fingerprint) { this.fingerprint = next; this.changed(cards); }
  }
}

export function validateQuestionAnswers(request: PanelQuestionRequest, raw: unknown): PanelQuestionAnswer[] {
  if (!Array.isArray(raw) || raw.length !== request.questions.length) throw new Error("Answer every question before continuing.");
  const ids = new Set<string>();
  return request.questions.map((question) => {
    const answer = raw.find((value) => value?.questionId === question.id);
    if (!answer || ids.has(answer.questionId)) throw new Error("Answer each question exactly once.");
    ids.add(answer.questionId);
    const forms = ["selectedLabel", "selectedLabels", "freeText"].filter((field) => answer[field] !== undefined);
    if (forms.length !== 1) throw new Error("Choose options or write an answer for each question.");
    const result: PanelQuestionAnswer = { questionId: question.id };
    const labels = question.options.map((option) => option.label);
    if (forms[0] === "freeText") {
      if (typeof answer.freeText !== "string" || !answer.freeText.trim() || answer.freeText.length > 500) throw new Error("Written answers must contain 1–500 characters.");
      result.freeText = answer.freeText;
    } else if (forms[0] === "selectedLabel") {
      if (question.selection.mode !== "single" || !labels.includes(answer.selectedLabel)) throw new Error("Choose one of Muse's offered options.");
      result.selectedLabel = answer.selectedLabel;
    } else {
      const selected = answer.selectedLabels;
      const minimum = question.selection.minSelections ?? 1;
      const maximum = question.selection.maxSelections ?? labels.length;
      if (question.selection.mode !== "multiple" || !Array.isArray(selected) || selected.length < minimum || selected.length > maximum ||
          new Set(selected).size !== selected.length || selected.some((label) => !labels.includes(label))) {
        throw new Error(`Choose ${minimum}–${maximum} offered options.`);
      }
      result.selectedLabels = selected;
    }
    if (answer.note !== undefined) {
      if (typeof answer.note !== "string" || answer.note.length > 500) throw new Error("Answer notes must be at most 500 characters.");
      result.note = answer.note;
    }
    return result;
  });
}
