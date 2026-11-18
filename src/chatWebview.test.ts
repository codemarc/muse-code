import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

type Listener = (event: any) => void;

class FakeClassList {
  private readonly names = new Set<string>();

  add(name: string): void {
    this.names.add(name);
  }

  toggle(name: string, active: boolean): void {
    if (active) this.names.add(name);
    else this.names.delete(name);
  }

  contains(name: string): boolean {
    return this.names.has(name);
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  readonly style: Record<string, string> = {};
  hidden = false;
  className = "";
  type = "";
  title = "";
  href = "";
  value = "";
  placeholder = "";
  selectionStart = 0;
  selectionEnd = 0;
  disabled = false;
  checked = false;
  parent?: FakeElement;
  private ownText = "";
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly tagName = "div") {}

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.ownText = String(value ?? "");
    this.children.length = 0;
  }

  set innerHTML(value: string) {
    this.ownText = value;
    this.children.length = 0;
  }

  get childNodes(): FakeElement[] {
    return this.children;
  }

  get scrollHeight(): number {
    return this.children.length;
  }

  scrollTop = 0;
  clientHeight = 0;
  blurred = false;

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  get parentNode() { return this.parent; }
  removeChild(child: FakeElement) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = undefined;
    return child;
  }

  addEventListener(type: string, listener: Listener): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) {
      listener({ preventDefault() {} });
    }
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    const payload = { preventDefault() {}, ...event };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(payload);
    }
  }

  focused = false;
  focus(): void { this.focused = true; }

  blur(): void {
    this.blurred = true;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    const out: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const child of el.children) {
        if (className && child.hasClass(className)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void { this.attributes.delete(name); }

  hasClass(name: string): boolean {
    return (
      this.classList.contains(name) || this.className.split(/\s+/).includes(name)
    );
  }

  querySelector(selector: string): FakeElement | null {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    for (const child of this.children) {
      if (className && child.hasClass(className)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}

function loadChat(opts?: { platform?: string; state?: Record<string, unknown> }) {
  const ids = [
    "transcript",
    "approvals",
    "questions",
    "latest",
    "input",
    "send",
    "stop",
    "history",
    "session",
    "session-btn",
    "folder",
    "execution-mode",
    "setup",
    "setup-msg",
    "setup-install",
    "recheck",
    "docs",
    "muse-ai",
    "pick-folder",
    "mentions",
    "attachments",
    "attach",
    "attach-menu",
    "toolbar-history",
    "toolbar-new",
    "session-rename",
    "session-fork",
    "session-action-status",
    "mode-banner",
    "mode-banner-text",
    "mode-banner-dismiss",
    "draft-note",
    "session-conflict",
    "session-conflict-text",
    "session-conflict-panel",
    "session-conflict-new",
    "focus-hint",
    "mode-pill",
    "model-pill",
    "effort-pill",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  let onMessage: Listener | undefined;
  const posted: unknown[] = [];
  let savedState = opts?.state;

  const document = {
    getElementById: (id: string) => elements.get(id),
    createElement: (tag: string) => new FakeElement(tag),
    createTextNode: (text: string) => {
      const node = new FakeElement("#text");
      node.textContent = text;
      return node;
    },
  };
  const window = {
    addEventListener(type: string, listener: Listener) {
      if (type === "message") onMessage = listener;
    },
  };
  const script = readFileSync(resolve("media/chat.js"), "utf8");
  runInNewContext(script, {
    acquireVsCodeApi: () => ({
      getState: () => savedState,
      setState: (value: Record<string, unknown>) => { savedState = value; },
      postMessage: (msg: unknown) => {
        posted.push(msg);
      },
    }),
    document,
    window,
    navigator: { platform: opts?.platform ?? "MacIntel" },
  });

  const input = elements.get("input")!;
  return {
    transcript: elements.get("transcript")!,
    approvals: elements.get("approvals")!,
    questions: elements.get("questions")!,
    latest: elements.get("latest")!,
    savedState: () => savedState,
    input,
    sendBtn: elements.get("send")!,
    mentions: elements.get("mentions")!,
    attachments: elements.get("attachments")!,
    attachBtn: elements.get("attach")!,
    attachMenu: elements.get("attach-menu")!,
    toolbarHistory: elements.get("toolbar-history")!,
    toolbarNew: elements.get("toolbar-new")!,
    renameSession: elements.get("session-rename")!,
    forkSession: elements.get("session-fork")!,
    sessionActionStatus: elements.get("session-action-status")!,
    modeBanner: elements.get("mode-banner")!,
    modeBannerText: elements.get("mode-banner-text")!,
    modeBannerDismiss: elements.get("mode-banner-dismiss")!,
    draftNote: elements.get("draft-note")!,
    sessionConflict: elements.get("session-conflict")!,
    sessionConflictPanel: elements.get("session-conflict-panel")!,
    sessionConflictNew: elements.get("session-conflict-new")!,
    focusHint: elements.get("focus-hint")!,
    modePill: elements.get("mode-pill")!,
    modelPill: elements.get("model-pill")!,
    effortPill: elements.get("effort-pill")!,
    folder: elements.get("folder")!,
    posted,
    /** The fake document has no body, so menus are appended to the transcript. */
    lastMenu() {
      const menus = elements.get("transcript")!.querySelectorAll(".menu");
      const menu = menus[menus.length - 1];
      if (!menu) throw new Error("no menu open");
      return {
        el: menu,
        findItem(label: string) {
          const item = menu
            .querySelectorAll(".menu-item")
            .find((el) => el.querySelectorAll(".menu-label")[0]?.textContent === label);
          if (!item) throw new Error(`menu item not found: ${label}`);
          return item;
        },
      };
    },
    send(data: unknown) {
      if (!onMessage) throw new Error("chat message listener was not installed");
      onMessage({ data });
    },
    ready() {
      if (!onMessage) throw new Error("chat message listener was not installed");
      onMessage({ data: { type: "setup", ok: true } });
    },
  };
}

test("permission cards show offered choices, scope, feedback and submit only one decision", () => {
  const chat = loadChat();
  chat.send({ type: "approvals", items: [{ approvalId: "approval-a", toolName: "write_file", rawArgs: '{"content":"<script>test</script>"}',
    subject: { kind: "fileAccess", path: "test.txt" }, currentRequirementId: { sourceIndex: 2 },
    availableChoices: [{ choiceId: "once", label: "Allow once", scope: "once" },
      { choiceId: "reject", label: "Reject", scope: "once", acceptsFeedback: true },
      { choiceId: "remember", label: "Allow for session", scope: "session", rulePreview: "This session only" }] }] });
  expect(chat.approvals.hidden).toBe(false);
  const card = chat.approvals.children[0];
  expect(card.textContent).toContain("test.txt");
  expect(card.textContent).toContain("<script>test</script>");
  expect(card.textContent).toContain("This session only");
  const feedback = card.children.find((el) => el.tagName === "textarea")!;
  feedback.value = "Choose another file";
  const buttons = card.querySelector(".approval-actions")!.children.filter((el) => el.tagName === "button");
  expect(chat.posted.filter((msg: any) => msg.type === "approvalDecision")).toHaveLength(0);
  buttons[1].click(); buttons[0].click();
  expect(chat.posted.filter((msg: any) => msg.type === "approvalDecision")).toEqual([
    { type: "approvalDecision", approvalId: "approval-a", sourceIndex: 2, choiceId: "reject", feedback: "Choose another file" },
  ]);
  expect(buttons.every((button) => button.disabled)).toBe(true);
  chat.send({ type: "approvals", items: [] });
  expect(chat.approvals.hidden).toBe(true);
});

test("two chat views preserve their own identities, drafts and approval queues", () => {
  const a = loadChat({ state: { chatId: "chat-a", draft: "Draft A" } });
  const b = loadChat({ state: { chatId: "chat-b", draft: "Draft B" } });
  a.send({ type: "chatIdentity", chatId: "chat-a" });
  b.send({ type: "chatIdentity", chatId: "chat-b" });
  a.input.value = "New A"; a.input.dispatch("input");
  expect(a.savedState()?.chatId).toBe("chat-a");
  expect(b.savedState()?.chatId).toBe("chat-b");
  expect(b.input.value).toBe("Draft B");
  a.send({ type: "running", running: true });
  expect(a.toolbarNew.disabled).toBe(false);
  a.toolbarNew.click();
  expect(a.posted).toContainEqual({ type: "newSession" });
  b.ready();
  expect(b.sendBtn.disabled).toBe(false);
});

test("question forms send explicit choices and custom answers, preserving edits across retry", () => {
  const chat = loadChat();
  const request = { userInputId: "questions-a", submitting: false, questions: [
    { id: "language", header: "Language", question: "Which language?", selection: { mode: "single" }, options: [{ label: "TypeScript" }, { label: "JavaScript" }] },
    { id: "testing", header: "Testing", question: "Which tests?", selection: { mode: "single" }, options: [{ label: "Unit" }, { label: "Integration" }] },
  ] };
  chat.send({ type: "questions", items: [request] });
  const card = chat.questions.children[0];
  const fields = card.children.filter((el) => el.tagName === "fieldset");
  const send = card.querySelector(".question-send")!;
  send.click();
  expect(card.querySelector(".question-error")!.textContent).toContain("every question");
  expect(chat.posted.filter((msg: any) => msg.type === "questionAnswer")).toHaveLength(0);
  fields[0].querySelector(".question-option")!.children[0].checked = true;
  const written = fields[1].querySelector(".question-written")!;
  written.value = "MUSE_CUSTOM";
  send.click(); send.click();
  expect(chat.posted.filter((msg: any) => msg.type === "questionAnswer")).toEqual([{ type: "questionAnswer", userInputId: "questions-a", answers: [
    { questionId: "language", selectedLabel: "TypeScript" }, { questionId: "testing", freeText: "MUSE_CUSTOM" },
  ] }]);
  chat.send({ type: "questions", items: [{ ...request, submitting: true }] });
  expect(written.disabled).toBe(true);
  chat.send({ type: "questions", items: [{ ...request, error: "Retry this answer" }] });
  expect(written.value).toBe("MUSE_CUSTOM");
  expect(send.disabled).toBe(false);
  expect(card.querySelector(".question-error")!.textContent).toBe("Retry this answer");
  chat.send({ type: "questions", items: [] });
  expect(chat.questions.hidden).toBe(true);
  expect(chat.questions.children).toHaveLength(0);
});

test("multiple-selection questions enforce counts before submitting", () => {
  const chat = loadChat();
  chat.send({ type: "questions", items: [{ userInputId: "multiple", questions: [
    { id: "checks", header: "Checks", question: "Which checks?", selection: { mode: "multiple", minSelections: 1, maxSelections: 2 }, options: [{ label: "Unit" }, { label: "Integration" }, { label: "Lint" }] },
  ] }] });
  const card = chat.questions.children[0];
  const options = card.querySelectorAll(".question-option").map((el) => el.children[0]);
  options.forEach((el) => { el.checked = true; });
  const send = card.querySelector(".question-send")!;
  send.click();
  expect(chat.posted.filter((msg: any) => msg.type === "questionAnswer")).toHaveLength(0);
  options[2].checked = false;
  send.click();
  expect(chat.posted).toContainEqual({ type: "questionAnswer", userInputId: "multiple", answers: [{ questionId: "checks", selectedLabels: ["Unit", "Integration"] }] });
});

test("failed and timed-out MSP tools remain visible without fabricating an exit code", () => {
  const chat = loadChat();
  chat.send({ type: "config", toolDisplay: "minimal" });
  chat.send({ type: "tool", name: "powershell", status: "failed", resultRaw: "sandbox enforcement unavailable" });
  chat.send({ type: "tool", name: "powershell", status: "timedOut", resultRaw: "tool timed out" });
  const cards = chat.transcript.querySelectorAll(".tool-card");
  expect(cards).toHaveLength(2);
  expect(cards[0].hidden).toBe(false);
  expect(cards[0].querySelector(".tool-exit")!.textContent).toBe("failed");
  expect(cards[1].querySelector(".tool-exit")!.textContent).toBe("timed out");
  expect(cards[0].textContent).not.toContain("exit 1");
});

function tool(overrides: Record<string, unknown> = {}) {
  return {
    type: "tool",
    name: "CALL_01A023F",
    resultRaw: "raw payload",
    resultView: "Read text file `CHANGELOG.md`.\n1|# Changelog",
    execMeta: { exitCode: 0 },
    files: [
      {
        href: "/workspace/CHANGELOG.md",
        name: "CHANGELOG.md",
        label: "Document · MD",
      },
    ],
    ...overrides,
  };
}

function silentTool(overrides: Record<string, unknown> = {}) {
  return tool({
    name: "CALL_01A023F",
    resultView: '<READ-SKILL-RESULT NAME="SUPABASE" STATUS="OK" />',
    resultRaw: '{"status":"ok"}',
    execMeta: { exitCode: 0 },
    files: [],
    ...overrides,
  });
}

describe("chat tool-card disclosure", () => {
  test("compact mode renders one folded summary row", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send(tool());

    const card = chat.transcript.children[0];
    const disclosure = card.querySelector(".tool-disclosure");
    expect(disclosure).not.toBeNull();
    expect(disclosure!.tagName).toBe("button");
    expect(disclosure!.textContent).toContain("Read text file CHANGELOG.md.");
    expect(disclosure!.textContent).not.toContain("CALL_01A023F");
    expect(disclosure!.getAttribute("aria-expanded")).toBe("false");
    expect(card.querySelector(".tool-details")!.hidden).toBe(true);
    expect(card.querySelector(".tool-actions")!.hidden).toBe(true);
  });

  test("clicking the summary opens and folds all details", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send(tool());

    const card = chat.transcript.children[0];
    const disclosure = card.querySelector(".tool-disclosure");
    expect(disclosure).not.toBeNull();
    disclosure!.click();
    expect(disclosure!.getAttribute("aria-expanded")).toBe("true");
    expect(card.querySelector(".tool-details")!.hidden).toBe(false);
    expect(card.querySelector(".tool-actions")!.hidden).toBe(false);
    expect(card.querySelector(".file-chips")!.hidden).toBe(false);

    disclosure!.click();
    expect(disclosure!.getAttribute("aria-expanded")).toBe("false");
    expect(card.querySelector(".tool-details")!.hidden).toBe(true);
  });

  test("expanding or collapsing a card does not scroll the transcript", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send(tool());
    chat.send(tool({ execMeta: { description: "Second tool", exitCode: 0 } }));

    chat.transcript.scrollTop = 3;
    chat.transcript.children[0].querySelector(".tool-disclosure")!.click();
    expect(chat.transcript.scrollTop).toBe(3);
    expect(
      chat.transcript.children[0].querySelector(".tool-details")!.hidden,
    ).toBe(false);

    chat.transcript.children[0].querySelector(".tool-disclosure")!.click();
    expect(chat.transcript.scrollTop).toBe(3);

    chat.send({ type: "expandAll" });
    expect(chat.transcript.scrollTop).toBe(3);
    chat.send({ type: "collapseAll" });
    expect(chat.transcript.scrollTop).toBe(3);
  });

  test("failed tools remain folded with a failure badge", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send(tool({ execMeta: { description: "Run tests", exitCode: 1 } }));

    const card = chat.transcript.children[0];
    const disclosure = card.querySelector(".tool-disclosure");
    expect(disclosure).not.toBeNull();
    expect(disclosure!.getAttribute("aria-expanded")).toBe("false");
    expect(card.querySelector(".tool-exit-fail")!.textContent).toBe("exit 1");
  });

  test("summary priority hides opaque call ids and uses useful fallbacks", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send(
      tool({
        resultView: "Readable first line",
        execMeta: { description: "Human description", command: "ignored" },
      }),
    );
    chat.send(tool({ resultView: "Readable fallback", execMeta: {} }));
    chat.send(tool({ resultView: null, execMeta: { command: "git status" } }));
    chat.send(tool({ name: "search_files", resultView: null, execMeta: {} }));

    const summaries = chat.transcript.children.map((card) =>
      card.querySelector(".tool-summary"),
    );
    expect(summaries.every(Boolean)).toBe(true);
    const labels = summaries.map((summary) => summary!.textContent);
    expect(labels).toEqual([
      "Human description",
      "Readable fallback",
      "$ git status",
      "search files",
    ]);
  });

  test("generic Tool result titles use the first line of content", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send(
      tool({
        resultView: null,
        resultRaw: "ISM status — dirty working tree on main\nHead: abc",
        execMeta: {},
      }),
    );
    chat.send(
      tool({
        name: "tool_result",
        resultView: "Tool result",
        resultRaw: "{\n  \"ok\": true\n}",
        execMeta: {},
      }),
    );

    const labels = chat.transcript.children.map(
      (card) => card.querySelector(".tool-summary")!.textContent,
    );
    expect(labels).toEqual([
      "ISM status — dirty working tree on main",
      '"ok": true',
    ]);
  });

  test("balanced opens short output and folds long output", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "balanced" });
    chat.send(tool({ resultView: "short output" }));
    chat.send(
      tool({
        resultView: Array.from({ length: 13 }, (_, i) => `line ${i}`).join("\n"),
      }),
    );
    chat.send(tool({ resultView: "x".repeat(801) }));

    expect(
      chat.transcript.children[0].querySelector(".tool-details")!.hidden,
    ).toBe(false);
    expect(
      chat.transcript.children[1].querySelector(".tool-details")!.hidden,
    ).toBe(true);
    expect(
      chat.transcript.children[2].querySelector(".tool-details")!.hidden,
    ).toBe(true);
  });

  test("detailed opens long output", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "detailed" });
    chat.send(tool({ resultView: "x".repeat(900) }));
    expect(
      chat.transcript.children[0].querySelector(".tool-details")!.hidden,
    ).toBe(false);
  });

  test("config changes update only cards without a manual override", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send(tool());
    chat.send(
      tool({ execMeta: { description: "Second tool", exitCode: 0 } }),
    );
    chat.transcript.children[0].querySelector(".tool-disclosure")!.click();

    chat.send({ type: "config", toolDisplay: "detailed" });
    expect(
      chat.transcript.children[0].querySelector(".tool-details")!.hidden,
    ).toBe(false);
    expect(
      chat.transcript.children[1].querySelector(".tool-details")!.hidden,
    ).toBe(false);

    chat.send({ type: "config", toolDisplay: "compact" });
    expect(
      chat.transcript.children[0].querySelector(".tool-details")!.hidden,
    ).toBe(false);
    expect(
      chat.transcript.children[1].querySelector(".tool-details")!.hidden,
    ).toBe(true);
  });

  test("History rebuild applies the current display setting afresh", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "detailed" });
    chat.send({ type: "history", items: [tool()] });
    expect(
      chat.transcript.children[0].querySelector(".tool-details")!.hidden,
    ).toBe(false);

    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send({ type: "history", items: [tool()] });
    expect(
      chat.transcript.children[0].querySelector(".tool-details")!.hidden,
    ).toBe(true);
  });

  test("expandAll opens every card and collapseAll folds them", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send(tool());
    chat.send(tool({ execMeta: { description: "Second tool", exitCode: 0 } }));

    chat.send({ type: "expandAll" });
    expect(
      chat.transcript.children.map(
        (card) => card.querySelector(".tool-details")!.hidden,
      ),
    ).toEqual([false, false]);
    expect(
      chat.transcript.children.map((card) =>
        card.querySelector(".tool-disclosure")!.getAttribute("aria-expanded"),
      ),
    ).toEqual(["true", "true"]);

    chat.send({ type: "collapseAll" });
    expect(
      chat.transcript.children.map(
        (card) => card.querySelector(".tool-details")!.hidden,
      ),
    ).toEqual([true, true]);
    expect(
      chat.transcript.children.map((card) =>
        card.querySelector(".tool-disclosure")!.getAttribute("aria-expanded"),
      ),
    ).toEqual(["false", "false"]);
  });

  test("expandAll and collapseAll count as manual overrides", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send(tool());
    chat.send(tool({ execMeta: { description: "Second tool", exitCode: 0 } }));

    chat.send({ type: "expandAll" });
    chat.send({ type: "config", toolDisplay: "compact" });
    expect(
      chat.transcript.children[0].querySelector(".tool-details")!.hidden,
    ).toBe(false);
    expect(
      chat.transcript.children[1].querySelector(".tool-details")!.hidden,
    ).toBe(false);

    chat.send({ type: "collapseAll" });
    chat.send({ type: "config", toolDisplay: "detailed" });
    expect(
      chat.transcript.children[0].querySelector(".tool-details")!.hidden,
    ).toBe(true);
    expect(
      chat.transcript.children[1].querySelector(".tool-details")!.hidden,
    ).toBe(true);
  });
});

describe("chat minimal tool display", () => {
  test("minimal renders dense labeled rows that do not expand", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "minimal" });
    chat.send(tool({ execMeta: { description: "Check CLI", exitCode: 0 } }));

    expect(chat.transcript.children.length).toBe(1);
    const row = chat.transcript.children[0];
    expect(row.hasClass("tool-minimal")).toBe(true);
    expect(row.querySelector(".tool-summary")!.textContent).toBe("Check CLI");
    expect(row.querySelector(".tool-exit-ok")!.hidden).toBe(true);
    expect(row.querySelector(".tool-chevron")!.hidden).toBe(true);

    row.querySelector(".tool-disclosure")!.click();
    expect(row.querySelector(".tool-details")!.hidden).toBe(true);
    expect(row.querySelector(".tool-disclosure")!.getAttribute("aria-expanded")).toBe(
      "false",
    );

    chat.send({ type: "expandAll" });
    expect(row.querySelector(".tool-details")!.hidden).toBe(true);
  });

  test("silent runs collapse to a working pulse every five tools", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "minimal" });

    for (let i = 0; i < 4; i += 1) {
      chat.send(silentTool());
    }
    expect(chat.transcript.children.length).toBe(0);

    chat.send(silentTool());
    expect(chat.transcript.children.length).toBe(1);
    const pulse = chat.transcript.children[0];
    expect(pulse.hasClass("heartbeat")).toBe(true);
    expect(pulse.textContent).toContain("working…");

    for (let i = 0; i < 5; i += 1) {
      chat.send(silentTool());
    }
    expect(chat.transcript.children.length).toBe(2);
  });

  test("labeled rows and messages reset the silent run", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "minimal" });

    for (let i = 0; i < 4; i += 1) {
      chat.send(silentTool());
    }
    chat.send(tool({ execMeta: { description: "Labeled", exitCode: 0 } }));
    for (let i = 0; i < 4; i += 1) {
      chat.send(silentTool());
    }
    expect(chat.transcript.children.length).toBe(1);

    chat.send({ type: "assistant_final", text: "done" });
    for (let i = 0; i < 4; i += 1) {
      chat.send(silentTool());
    }
    expect(chat.transcript.children.length).toBe(2);
  });

  test("minimal failures keep a badge and stay expandable", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "minimal" });
    chat.send(
      tool({
        resultView: "<opaque>blob</opaque>",
        resultRaw: '{"a":1}',
        execMeta: { description: "Run tests", exitCode: 1 },
      }),
    );

    const row = chat.transcript.children[0];
    expect(row.querySelector(".tool-summary")!.textContent).toBe("Run tests");
    expect(row.querySelector(".tool-exit-fail")!.hidden).toBe(false);
    expect(row.querySelector(".tool-exit-fail")!.textContent).toBe("exit 1");
    expect(row.querySelector(".tool-chevron")!.hidden).toBe(false);

    row.querySelector(".tool-disclosure")!.click();
    expect(row.querySelector(".tool-details")!.hidden).toBe(false);
  });

  test("silent-shaped failures still render with a fallback label", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "minimal" });
    chat.send(silentTool({ execMeta: { exitCode: 1 } }));

    expect(chat.transcript.children.length).toBe(1);
    const label = chat.transcript.children[0].querySelector(".tool-summary")!;
    expect(label.textContent.length).toBeGreaterThan(0);
  });

  test("minimal prefers names and commands over raw content lines", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "minimal" });
    chat.send(
      tool({ name: "search_files", resultView: "<xml>blob</xml>", execMeta: {} }),
    );
    chat.send(
      tool({
        resultView: "<xml />",
        resultRaw: "{}",
        execMeta: { command: "git status" },
      }),
    );
    chat.send(tool({ resultView: "Readable first line", execMeta: {} }));

    const labels = chat.transcript.children.map(
      (row) => row.querySelector(".tool-summary")!.textContent,
    );
    expect(labels).toEqual(["search files", "$ git status", "Readable first line"]);
  });

  test("switching modes densifies, hides, and restores cards", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send(tool({ execMeta: { description: "Labeled", exitCode: 0 } }));
    chat.send(silentTool());

    const labeled = chat.transcript.children[0];
    const silent = chat.transcript.children[1];
    expect(labeled.querySelector(".tool-exit-ok")!.hidden).toBe(false);

    chat.send({ type: "config", toolDisplay: "minimal" });
    expect(labeled.hasClass("tool-minimal")).toBe(true);
    expect(labeled.querySelector(".tool-exit-ok")!.hidden).toBe(true);
    expect(labeled.querySelector(".tool-summary")!.textContent).toBe("Labeled");
    expect(silent.hidden).toBe(true);

    chat.send({ type: "config", toolDisplay: "compact" });
    expect(labeled.hasClass("tool-minimal")).toBe(false);
    expect(labeled.querySelector(".tool-exit-ok")!.hidden).toBe(false);
    expect(silent.hidden).toBe(false);
    expect(silent.querySelector(".tool-summary")!.textContent).toContain(
      "READ-SKILL-RESULT",
    );
  });
});

describe("composer submit key", () => {
  test("next-message drafts stay editable and survive streaming, Stop and history refresh without auto-send", () => {
    const chat = loadChat(); chat.ready();
    chat.input.value = "first request";
    chat.input.dispatch("keydown", { key: "Enter", ctrlKey: true });
    chat.send({ type: "submitAccepted" });
    chat.send({ type: "running", running: true });
    chat.send({ type: "submitFinished" });
    expect(chat.input.disabled).toBe(false);
    expect(chat.sendBtn.disabled).toBe(true);
    expect(chat.draftNote.hidden).toBe(false);
    chat.input.value = "my next change";
    chat.input.dispatch("input");
    chat.send({ type: "assistant_delta", text: "streaming" });
    chat.input.dispatch("keydown", { key: "Enter", ctrlKey: true });
    expect(chat.posted.filter((msg: any) => msg.type === "submit")).toHaveLength(1);
    chat.send({ type: "status", text: "Stopped" });
    chat.send({ type: "running", running: false });
    chat.send({ type: "history", items: [{ type: "user", text: "first request" }] });
    expect(chat.input.value).toBe("my next change");
    expect(chat.savedState()?.draft).toBe("my next change");
    expect(chat.sendBtn.disabled).toBe(false);
    expect(chat.posted.filter((msg: any) => msg.type === "submit")).toHaveLength(1);
  });

  test("reuse loads a reviewed draft with explicit context and never replaces an occupied composer", () => {
    const chat = loadChat(); chat.ready();
    chat.send({ type: "user", prompt: "fix @src/app.ts", attached: ["src/app.ts", "Problems"], requestContext: [{ kind: "file", path: "src/app.ts" }, { kind: "problems" }] });
    const reuse = chat.transcript.querySelector(".message-reuse")!;
    reuse.click();
    expect(chat.input.value).toBe("fix @src/app.ts");
    expect(chat.savedState()?.attachments).toEqual([{ kind: "file", path: "src/app.ts" }, { kind: "problems" }]);
    expect(chat.posted.some((msg: any) => msg.type === "submit")).toBe(false);
    chat.input.value = "keep this draft"; chat.input.dispatch("input");
    reuse.click();
    expect(chat.input.value).toBe("keep this draft");
    expect(reuse.disabled).toBe(true);
  });

  test("older messages without retained descriptors explicitly ask to reattach context", () => {
    const chat = loadChat(); chat.ready();
    chat.send({ type: "history", items: [{ type: "user", text: "review files", attached: ["Problems", "src/app.ts"] }] });
    chat.transcript.querySelector(".message-reuse")!.click();
    expect(chat.input.value).toBe("review files");
    expect(chat.savedState()?.attachments).toEqual([]);
    expect(chat.draftNote.textContent).toContain("Reattach context");
    expect(chat.draftNote.textContent).toContain("src/app.ts");
    expect(chat.posted.some((msg: any) => msg.type === "submit")).toBe(false);
  });
  test("incompatible session keeps draft and attachments and offers explicit recovery without sending", () => {
    const chat = loadChat({ state: { draft: "keep @src/app.ts", attachments: [{ kind: "problems" }], mentionedFiles: ["src/app.ts"] } });
    chat.ready();
    chat.send({ type: "session", sessionId: "old-panel" });
    chat.send({ type: "config", executionMode: "windows" });
    const conflict = { sessionId: "old-panel", mode: "windows", text: "Stored policy needs Panel approvals" };
    chat.send({ type: "sessionCompatibility", sessionId: "old-panel", mode: "windows", conflict });
    expect(chat.sessionConflict.hidden).toBe(false);
    expect(chat.sendBtn.disabled).toBe(true);
    expect(chat.input.disabled).toBe(false);
    chat.input.dispatch("keydown", { key: "Enter", ctrlKey: true });
    expect(chat.posted.some((msg: any) => msg.type === "submit")).toBe(false);
    expect(chat.input.value).toBe("keep @src/app.ts");
    expect(chat.savedState()?.attachments).toEqual([{ kind: "problems" }]);
    chat.sessionConflictPanel.click();
    expect(chat.posted).toContainEqual({ type: "resolveSessionMode", sessionId: "old-panel", mode: "windows", action: "panel" });
    chat.sessionConflictNew.click();
    expect(chat.posted).toContainEqual({ type: "resolveSessionMode", sessionId: "old-panel", mode: "windows", action: "newSession" });
    chat.send({ type: "session", sessionId: "new-exec" });
    chat.send({ type: "history", items: [], source: "new" });
    expect(chat.sessionConflict.hidden).toBe(true);
    expect(chat.input.value).toBe("keep @src/app.ts");
    chat.input.dispatch("keydown", { key: "Enter", ctrlKey: true });
    expect(chat.posted.find((msg: any) => msg.type === "submit")).toMatchObject({ prompt: "keep @src/app.ts", attachments: [{ kind: "problems" }, { kind: "file", path: "src/app.ts" }] });
  });

  test("mode recovery ignores stale session/mode messages and cannot act during a run", () => {
    const chat = loadChat(); chat.ready();
    chat.send({ type: "session", sessionId: "active" });
    chat.send({ type: "config", executionMode: "windows" });
    const conflict = { sessionId: "active", mode: "windows", text: "Needs panel" };
    chat.send({ type: "sessionCompatibility", sessionId: "active", mode: "windows", conflict });
    chat.send({ type: "sessionCompatibility", sessionId: "old", mode: "windows", conflict: null });
    expect(chat.sessionConflict.hidden).toBe(false);
    chat.send({ type: "running", running: true });
    chat.sessionConflictNew.click();
    expect(chat.posted.some((msg: any) => msg.type === "resolveSessionMode")).toBe(false);
    chat.send({ type: "running", running: false });
    chat.send({ type: "config", executionMode: "panel" });
    expect(chat.sessionConflict.hidden).toBe(true);
    chat.send({ type: "sessionCompatibility", sessionId: "active", mode: "windows", conflict });
    expect(chat.sessionConflict.hidden).toBe(true);
    expect(chat.sendBtn.disabled).toBe(false);
  });
  test("persistent turn cards keep separate diffs and disable completed undo actions", () => {
    const chat = loadChat();
    chat.ready();
    const turns = ["one", "two"].map((id) => ({ turnId: id, createdAt: 1, prompt: id, files: [{ path: "src/app.ts", status: "M" }], undone: id === "one" }));
    chat.send({ type: "turnReviews", turns });
    expect(chat.transcript.querySelectorAll(".undo-turn").length).toBe(2);
    const buttons = chat.transcript.querySelectorAll(".undo-turn");
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[0].textContent).toBe("Redo this turn");
    buttons[0].click();
    expect(chat.posted).toContainEqual({ type: "redoTurn", turnId: "one" });
    chat.transcript.querySelectorAll(".changed-file")[1].click();
    expect(chat.posted).toContainEqual({ type: "openTurnDiff", turnId: "two", path: "src/app.ts" });
    buttons[1].click();
    expect(chat.posted).toContainEqual({ type: "undoTurn", turnId: "two" });
    expect(buttons[1].disabled).toBe(true);
    chat.send({ type: "turnReviews", turns });
    expect(chat.transcript.querySelectorAll(".undo-turn").length).toBe(2);
    chat.send({ type: "running", running: true });
    expect(chat.transcript.querySelectorAll(".undo-turn").every((button) => button.disabled)).toBe(true);
    chat.send({ type: "running", running: false });
    expect(chat.transcript.querySelectorAll(".undo-turn")[1].disabled).toBe(false);
    chat.send({ type: "history", items: [] });
    chat.send({ type: "turnReviews", turns });
    expect(chat.transcript.querySelectorAll(".undo-turn").length).toBe(2);
  });
  test("copies final Markdown and shows clipboard failures without losing the response", () => {
    const chat = loadChat();
    chat.send({ type: "assistant_delta", text: "partial" });
    chat.send({ type: "assistant_final", text: "**final**\n\n```ts\nconst x = 1;\n```", html: "<strong>final</strong>" });
    const button = chat.transcript.querySelector(".message-copy")!;
    button.click();
    const copy = chat.posted.find((msg: any) => msg.type === "copyText") as any;
    expect(copy.text).toBe("**final**\n\n```ts\nconst x = 1;\n```");
    expect(button.disabled).toBe(true);
    chat.send({ type: "copyResult", requestId: copy.requestId, ok: false });
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("retry");
    button.click();
    chat.send({ type: "copyResult", requestId: copy.requestId + 1, ok: true });
    expect(button.textContent).toBe("Copied");
  });

  test("review file buttons open native diffs and updated summaries replace older cards", () => {
    const chat = loadChat();
    chat.send({ type: "changes", files: [{ path: "src/app.ts", status: "M" }], markdown: "diff" });
    expect(chat.transcript.textContent).toContain("1 file changed.");
    chat.transcript.querySelector(".changed-file")!.click();
    expect(chat.posted).toContainEqual({ type: "openChangedFile", path: "src/app.ts" });
    chat.send({ type: "changes", files: [{ path: "new.ts", status: "??" }], markdown: "new" });
    expect(chat.transcript.querySelectorAll(".changed-file").length).toBe(1);
    expect(chat.transcript.textContent).toContain("new.ts");
  });
  test("restores draft and file mentions after webview recreation", () => {
    const chat = loadChat({ state: { draft: "fix @src/app.ts", attachments: [{ kind: "problems" }], mentionedFiles: ["src/app.ts"] } });
    chat.ready();
    expect(chat.input.value).toBe("fix @src/app.ts");
    chat.input.dispatch("keydown", { key: "Enter", ctrlKey: true });
    const submit = chat.posted.find((msg: any) => msg.type === "submit") as any;
    expect(submit.attachments).toEqual([{ kind: "problems" }, { kind: "file", path: "src/app.ts" }]);
    chat.send({ type: "submitAccepted" });
    expect(chat.savedState()?.draft).toBe("");
    expect(chat.savedState()?.attachments).toEqual([]);
  });

  test("persists edits and retains cancelled draft across recreation", () => {
    const chat = loadChat();
    chat.ready();
    chat.input.value = "unsent work";
    chat.input.dispatch("input");
    chat.input.dispatch("keydown", { key: "Enter", ctrlKey: true });
    chat.send({ type: "submitFinished" });
    const reopened = loadChat({ state: chat.savedState() });
    expect(reopened.input.value).toBe("unsent work");
  });
  function submitPosts(chat: { posted: unknown[] }) {
    return chat.posted.filter(
      (msg) =>
        Boolean(msg) &&
        typeof msg === "object" &&
        (msg as { type?: string }).type === "submit",
    );
  }

  test("⌘Enter / Ctrl+Enter sends, Enter inserts a newline", () => {
    const chat = loadChat({ platform: "MacIntel" });
    chat.ready();
    chat.input.value = "hello muse";

    chat.input.dispatch("keydown", { key: "Enter", shiftKey: false });
    expect(submitPosts(chat)).toEqual([]);
    expect(chat.input.value).toBe("hello muse");

    chat.input.dispatch("keydown", {
      key: "Enter",
      metaKey: true,
    });
    expect(submitPosts(chat)).toEqual([
      { type: "submit", prompt: "hello muse", attachments: [] },
    ]);
    expect(chat.input.value).toBe("hello muse");
    chat.send({ type: "submitAccepted" });
    expect(chat.input.value).toBe("");
  });

  test("Ctrl+Enter sends on non-Mac", () => {
    const chat = loadChat({ platform: "Linux x86_64" });
    chat.ready();
    chat.input.value = "ping";
    chat.input.dispatch("keydown", { key: "Enter", ctrlKey: true });
    expect(submitPosts(chat)).toEqual([
      { type: "submit", prompt: "ping", attachments: [] },
    ]);
  });

  test("preflight prevents duplicate sends and keeps a cancelled draft", () => {
    const chat = loadChat();
    chat.ready();
    chat.input.value = "keep my draft";
    chat.input.dispatch("keydown", { key: "Enter", ctrlKey: true });
    chat.input.dispatch("keydown", { key: "Enter", ctrlKey: true });
    expect(submitPosts(chat).length).toBe(1);
    expect(chat.input.value).toBe("keep my draft");
    expect(chat.sendBtn.disabled).toBe(true);
    chat.send({ type: "submitFinished" });
    expect(chat.input.value).toBe("keep my draft");
    expect(chat.sendBtn.disabled).toBe(false);
    chat.input.dispatch("keydown", { key: "Enter", ctrlKey: true });
    expect(submitPosts(chat).length).toBe(2);
  });

  test("placeholder names the submit chord", () => {
    const mac = loadChat({ platform: "MacIntel" });
    expect(mac.input.placeholder).toContain("⌘Enter");
    expect(mac.sendBtn.title).toContain("⌘Enter");

    const linux = loadChat({ platform: "Linux x86_64" });
    expect(linux.input.placeholder).toContain("Ctrl+Enter");
    expect(linux.sendBtn.title).toContain("Ctrl+Enter");
  });
});

describe("transcript follow behavior", () => {
  test("streaming and history refresh respect reading position; Latest resumes following", () => {
    const chat = loadChat();
    chat.ready();
    for (let i = 0; i < 100; i++) chat.send({ type: "user", prompt: String(i) });
    chat.transcript.clientHeight = 10;
    chat.transcript.scrollTop = 5;
    chat.transcript.dispatch("scroll");
    chat.send({ type: "assistant_delta", text: "new response" });
    expect(chat.transcript.scrollTop).toBe(5);
    expect(chat.latest.hidden).toBe(false);
    chat.send({ type: "history", items: Array.from({ length: 100 }, (_, i) => ({ type: "assistant", text: String(i) })) });
    expect(chat.transcript.scrollTop).toBe(5);
    chat.latest.click();
    expect(chat.transcript.scrollTop).toBe(chat.transcript.scrollHeight);
    expect(chat.latest.hidden).toBe(true);
  });
});

describe("composer file mentions", () => {
  function mentionPosts(chat: { posted: unknown[] }) {
    return chat.posted.filter(
      (msg) =>
        Boolean(msg) &&
        typeof msg === "object" &&
        (msg as { type?: string }).type === "mentionQuery",
    );
  }

  test("typing @ posts a mention query", () => {
    const chat = loadChat();
    chat.input.value = "see @ch";
    chat.input.selectionStart = 7;
    chat.input.dispatch("input");
    expect(mentionPosts(chat)).toEqual([
      { type: "mentionQuery", query: "ch", requestId: 1 },
    ]);
  });

  test("picking a result inserts an inline @path token", () => {
    const chat = loadChat();
    chat.input.value = "see @ch";
    chat.input.selectionStart = 7;
    chat.input.dispatch("input");
    chat.send({
      type: "mentionResults",
      requestId: 1,
      items: [{ path: "src/chat.js", source: "open" }],
    });
    expect(chat.mentions.hidden).toBe(false);
    chat.mentions.children[0]!.dispatch("mousedown");
    expect(chat.input.value).toBe("see @src/chat.js ");
    expect(chat.mentions.hidden).toBe(true);
    // No separate chip: the file is shown inline in the prompt.
    expect(chat.attachments.children.length).toBe(0);
  });

  test("submit attaches @files that are still in the prompt", () => {
    const chat = loadChat();
    chat.ready();
    chat.input.value = "see @ch";
    chat.input.selectionStart = 7;
    chat.input.dispatch("input");
    chat.send({
      type: "mentionResults",
      requestId: 1,
      items: [{ path: "src/chat.js", source: "open" }],
    });
    chat.mentions.children[0]!.dispatch("mousedown");
    chat.input.value = chat.input.value + "explain this";
    chat.input.dispatch("keydown", { key: "Enter", metaKey: true });
    const submits = chat.posted.filter(
      (msg) =>
        Boolean(msg) &&
        typeof msg === "object" &&
        (msg as { type?: string }).type === "submit",
    );
    expect(submits).toEqual([
      {
        type: "submit",
        prompt: "see @src/chat.js explain this",
        attachments: [{ kind: "file", path: "src/chat.js" }],
      },
    ]);
    chat.send({ type: "submitAccepted" });
    expect(chat.input.value).toBe("");
  });

  test("an @file deleted from the prompt is not attached", () => {
    const chat = loadChat();
    chat.ready();
    chat.input.value = "see @ch";
    chat.input.selectionStart = 7;
    chat.input.dispatch("input");
    chat.send({
      type: "mentionResults",
      requestId: 1,
      items: [{ path: "src/chat.js", source: "open" }],
    });
    chat.mentions.children[0]!.dispatch("mousedown");
    chat.input.value = "never mind";
    chat.input.dispatch("keydown", { key: "Enter", metaKey: true });
    const submit = chat.posted.find(
      (msg) => (msg as { type?: string }).type === "submit",
    ) as { attachments: unknown[] };
    expect(submit.attachments).toEqual([]);
  });

  test("mentioning the same file twice attaches it once", () => {
    const chat = loadChat();
    chat.ready();
    for (const [query, id] of [["see @ch", 1], ["see @src/chat.js and @ch", 2]] as const) {
      chat.input.value = query;
      chat.input.selectionStart = query.length;
      chat.input.dispatch("input");
      chat.send({
        type: "mentionResults",
        requestId: id,
        items: [{ path: "src/chat.js", source: "open" }],
      });
      chat.mentions.children[0]!.dispatch("mousedown");
    }
    chat.input.dispatch("keydown", { key: "Enter", metaKey: true });
    const submit = chat.posted.find(
      (msg) => (msg as { type?: string }).type === "submit",
    ) as { attachments: unknown[] };
    expect(submit.attachments).toEqual([{ kind: "file", path: "src/chat.js" }]);
  });

  test("user messages render attached chips", () => {
    const chat = loadChat();
    chat.send({ type: "user", prompt: "fix this", attached: ["src/a.ts", "Problems"] });
    const card = chat.transcript.children[0]!;
    expect(card.textContent).toContain("fix this");
    expect(card.textContent).toContain("src/a.ts");
    expect(card.textContent).toContain("Problems");
    chat.send({
      type: "history",
      items: [{ type: "user", text: "old", attached: ["Terminal"] }],
    });
    expect(chat.transcript.children[0]!.textContent).toContain("Terminal");
  });

  test("renders a changed-files card with an Open diff action", () => {
    const chat = loadChat();
    chat.send({
      type: "changes",
      files: [{ path: "src/chat.js", status: "M" }],
      markdown: "# Changed files\n",
    });
    const card = chat.transcript.children[0]!;
    expect(card.textContent).toContain("src/chat.js");
    expect(card.textContent).toContain("Open diff");
  });
});

describe("editor tab header, banner, and pills", () => {
  test("session search selects results with the keyboard and ignores stale or closed responses", () => {
    const chat = loadChat();
    chat.toolbarHistory.click();
    const menu = chat.lastMenu().el;
    const search = menu.querySelector(".session-search")!;
    expect(search.focused).toBe(true);
    search.value = "old task";
    search.dispatch("input");
    const requests = chat.posted.filter((msg: any) => msg.type === "listSessions") as any[];
    expect(requests[1].query).toBe("old task");
    chat.send({ type: "sessionList", requestId: requests[0].requestId, items: [{ id: "stale", title: "stale" }] });
    expect(menu.querySelectorAll(".session-result")).toHaveLength(0);
    chat.send({ type: "sessionList", requestId: requests[1].requestId, limit: 40, items: [
      { id: "one", title: "First matching task", preview: "first prompt", updatedMs: 0 },
      { id: "two", title: "Second matching task", updatedMs: 0 },
    ] });
    expect(menu.querySelectorAll(".session-result")).toHaveLength(2);
    expect(search.value).toBe("old task");
    search.dispatch("keydown", { key: "ArrowDown" });
    expect(menu.querySelectorAll(".session-result")[1].getAttribute("aria-selected")).toBe("true");
    search.dispatch("keydown", { key: "Enter" });
    expect(chat.posted).toContainEqual({ type: "resumeSession", sessionId: "two" });
    chat.send({ type: "sessionList", requestId: requests[1].requestId, items: [{ id: "late", title: "late" }] });
    expect(chat.transcript.querySelectorAll(".session-menu")).toHaveLength(0);
  });

  test("session search shows empty results, ignores IME Enter, and Escape restores header focus", () => {
    const chat = loadChat();
    chat.toolbarHistory.click();
    const menu = chat.lastMenu().el;
    const search = menu.querySelector(".session-search")!;
    search.value = "no match";
    search.dispatch("input");
    const request = chat.posted.filter((msg: any) => msg.type === "listSessions").at(-1) as any;
    chat.send({ type: "sessionList", requestId: request.requestId, items: [] });
    expect(menu.textContent).toContain("No matching sessions");
    search.dispatch("keydown", { key: "Enter", isComposing: true });
    expect(chat.posted.some((msg: any) => msg.type === "resumeSession")).toBe(false);
    menu.dispatch("keydown", { key: "Escape" });
    expect(chat.toolbarHistory.focused).toBe(true);
    expect(chat.transcript.querySelectorAll(".session-menu")).toHaveLength(0);
  });
  function postedTypes(chat: { posted: unknown[] }) {
    return chat.posted
      .map((msg) => (msg as { type?: string }).type)
      .filter((type) => type !== "ready");
  }

  const headlessConfig = {
    type: "config",
    executionMode: "headless",
    executionModeLabel: "Headless",
    executionModeDescription: "Native chat path.",
    model: "",
    reasoningEffort: "",
  };

  test("focus hint names the unfocus key", () => {
    const mac = loadChat({ platform: "MacIntel" });
    expect(mac.focusHint.textContent).toContain("⌘ Esc");
    const linux = loadChat({ platform: "Linux x86_64" });
    expect(linux.focusHint.textContent).toContain("Esc");
  });

  test("config shows the mode banner and pills with fallbacks", () => {
    const chat = loadChat();
    chat.send(headlessConfig);
    expect(chat.modeBanner.hidden).toBe(false);
    expect(chat.modeBannerText.textContent).toContain("Headless mode active");
    expect(chat.modeBannerText.textContent).toContain("Native chat path.");
    expect(chat.modePill.textContent).toBe("Headless");
    expect(chat.modePill.title).toContain("Mode: Headless");
    expect(chat.modelPill.textContent).toBe("Model auto");
    expect(chat.effortPill.textContent).toBe("Effort default");
  });

  test("pills render configured model and effort", () => {
    const chat = loadChat();
    chat.send({
      ...headlessConfig,
      model: "muse-3",
      reasoningEffort: "medium",
    });
    expect(chat.modelPill.textContent).toBe("Model muse-3");
    expect(chat.effortPill.textContent).toBe("Effort Medium");
  });

  test("dismiss hides the banner until the mode changes", () => {
    const chat = loadChat();
    chat.send(headlessConfig);
    expect(chat.modeBanner.hidden).toBe(false);
    chat.modeBannerDismiss.click();
    expect(chat.modeBanner.hidden).toBe(true);
    chat.send(headlessConfig);
    expect(chat.modeBanner.hidden).toBe(true);
    chat.send({
      ...headlessConfig,
      executionMode: "interactive",
      executionModeLabel: "Interactive",
    });
    expect(chat.modeBanner.hidden).toBe(false);
  });

  test("toolbar buttons request the session list and a new session", () => {
    const chat = loadChat();
    chat.toolbarHistory.click();
    chat.toolbarNew.click();
    expect(postedTypes(chat)).toEqual(["listSessions", "newSession"]);
  });

  test("model picker can turn the echo provider off and on", () => {
    const chat = loadChat();
    const base = {
      type: "config",
      executionMode: "headless",
      executionModeLabel: "Headless",
      model: "",
      reasoningEffort: "",
      modelOptions: [{ value: "", label: "Auto" }],
      effortOptions: [{ value: "", label: "Default" }],
    };
    chat.send({ ...base, useEchoProvider: true });
    expect(chat.modelPill.textContent).toBe("Echo");
    chat.modelPill.click();
    chat.lastMenu().findItem("Use Meta models").click();
    chat.send({ ...base, useEchoProvider: false });
    expect(chat.modelPill.textContent).toBe("Model auto");
    chat.modelPill.click();
    chat.lastMenu().findItem("Echo (offline test)").click();
    const settings = chat.posted.filter(
      (msg) => (msg as { type?: string }).type === "setSetting",
    );
    expect(settings).toEqual([
      { type: "setSetting", key: "useEchoProvider", value: "false" },
      { type: "setSetting", key: "useEchoProvider", value: "true" },
    ]);
  });

  test("the open model picker loads the live catalog and selects a new model", () => {
    const chat = loadChat();
    chat.send({ type: "config", model: "", modelOptions: [{ value: "", label: "Auto" }] });
    chat.modelPill.click();
    expect(chat.posted.at(-1)).toEqual({ type: "listModels", requestId: 1 });
    chat.send({
      type: "modelCatalog",
      requestId: 1,
      options: [{ value: "", label: "Auto" }, { value: "muse-ember-1.0", label: "Muse Ember" }],
    });
    chat.lastMenu().findItem("Muse Ember").click();
    expect(chat.posted.at(-1)).toEqual({ type: "setSetting", key: "model", value: "muse-ember-1.0" });
    chat.modelPill.click();
    chat.modelPill.click();
    chat.send({ type: "modelCatalog", requestId: 2, options: null });
    expect(() => chat.lastMenu()).toThrow("no menu open");
    chat.modelPill.click();
    chat.send({ type: "modelCatalog", requestId: 3, options: null });
    expect(chat.lastMenu().el.querySelector(".menu-empty")?.textContent).toContain("Catalog unavailable");
    expect(chat.lastMenu().findItem("Auto")).toBeDefined();
  });

  test("pills open pickers that post setSetting", () => {
    const chat = loadChat();
    chat.send({
      type: "config",
      executionMode: "headless",
      executionModeLabel: "Headless",
      model: "",
      reasoningEffort: "",
      modelOptions: [
        { value: "", label: "Auto" },
        { value: "muse-spark-1.3", label: "muse-spark-1.3" },
      ],
      effortOptions: [
        { value: "", label: "Default" },
        { value: "low", label: "Low" },
      ],
    });
    const pick = (pill: { click: () => void }, label: string) => {
      pill.click();
      const menu = chat.lastMenu();
      const item = menu.findItem(label);
      item.click();
    };
    pick(chat.modelPill, "muse-spark-1.3");
    pick(chat.effortPill, "Low");
    pick(chat.modePill, "Interactive");
    const settings = chat.posted.filter(
      (msg) => (msg as { type?: string }).type === "setSetting",
    );
    expect(settings).toEqual([
      { type: "setSetting", key: "model", value: "muse-spark-1.3" },
      { type: "setSetting", key: "reasoningEffort", value: "low" },
      { type: "setSetting", key: "executionMode", value: "interactive" },
    ]);
  });

  test("session actions protect active turns and drafts while native operations settle", () => {
    const chat = loadChat(); chat.ready();
    chat.input.value = "keep my draft";
    chat.send({ type: "running", running: true });
    expect(chat.renameSession.disabled).toBe(true);
    expect(chat.forkSession.disabled).toBe(true);
    chat.forkSession.click();
    expect(chat.posted.some((m: any) => m.type === "forkSession")).toBe(false);
    chat.send({ type: "running", running: false });
    chat.renameSession.click();
    expect(chat.posted.at(-1)).toEqual({ type: "renameSession" });
    chat.send({ type: "sessionAction", busy: true, action: "fork" });
    expect(chat.sendBtn.disabled).toBe(true);
    expect(chat.input.disabled).toBe(false);
    expect(chat.sessionActionStatus.textContent).toContain("Workspace files stay");
    chat.sendBtn.click();
    chat.input.dispatch("keydown", { key: "Enter", metaKey: true });
    expect(chat.posted.some((m: any) => m.type === "submit")).toBe(false);
    expect(chat.input.value).toBe("keep my draft");
    chat.send({ type: "sessionAction", busy: false, action: "fork" });
    expect(chat.sendBtn.disabled).toBe(false);
    expect(chat.sessionActionStatus.hidden).toBe(true);
    expect(chat.input.value).toBe("keep my draft");
    chat.forkSession.click();
    expect(chat.posted.at(-1)).toEqual({ type: "forkSession" });
  });

  test("Escape blurs the composer input", () => {
    const chat = loadChat();
    chat.input.dispatch("keydown", { key: "Escape" });
    expect(chat.input.blurred).toBe(true);
  });

  test("folder shows only when multiple folders are open", () => {
    const chat = loadChat();

    chat.send({
      type: "folder",
      name: "codemarc.github.io",
      path: "/sites/codemarc.github.io",
      multi: false,
    });
    expect(chat.folder.hidden).toBe(true);
    expect(chat.folder.textContent).toBe("");

    chat.send({ type: "folder", name: "site", path: "/y", multi: true });
    expect(chat.folder.hidden).toBe(false);
    expect(chat.folder.textContent).toBe("folder: site");

    chat.send({ type: "folder", name: null, path: null, multi: true });
    expect(chat.folder.hidden).toBe(false);
    expect(chat.folder.textContent).toBe("folder: (pick one)");
  });
});
