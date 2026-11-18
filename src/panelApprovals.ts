import type { ApprovalHandler, ApprovalDecisionInput } from "@muse-code/sdk";

export type PanelApproval = Parameters<ApprovalHandler>[0];

/** Decisions stay pending until the person selects an offered, current-stage choice. */
export class PanelApprovals {
  private readonly pending = new Map<string, {
    request: PanelApproval;
    resolve: (choice: ApprovalDecisionInput) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly changed: (requests: PanelApproval[]) => void) {}

  readonly request: ApprovalHandler = (request) => new Promise((resolve, reject) => {
    const old = this.pending.get(request.approvalId);
    old?.reject(new Error("Approval stage superseded."));
    this.pending.set(request.approvalId, { request, resolve, reject });
    this.publish();
  });

  decide(approvalId: string, sourceIndex: number, choiceId: string, feedback?: string): void {
    const entry = this.pending.get(approvalId);
    if (!entry || entry.request.currentRequirementId.sourceIndex !== sourceIndex) {
      throw new Error("This approval changed or is no longer pending.");
    }
    const choice = entry.request.availableChoices.find((choice) => choice.choiceId === choiceId);
    if (!choice) throw new Error("Choose an option offered by Muse.");
    if (feedback && !choice.acceptsFeedback) throw new Error("This option does not accept feedback.");
    this.pending.delete(approvalId);
    entry.resolve({ choiceId, ...(feedback ? { feedback } : {}) });
    this.publish();
  }

  clear(): void {
    for (const entry of this.pending.values()) entry.reject(new Error("Turn ended."));
    this.pending.clear();
    this.publish();
  }

  list(): PanelApproval[] { return [...this.pending.values()].map((entry) => entry.request); }
  private publish(): void { this.changed(this.list()); }
}
