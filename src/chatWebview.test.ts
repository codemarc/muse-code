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
  blurred = false;

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
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

  focus(): void {}

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

function loadChat(opts?: { platform?: string }) {
  const ids = [
    "transcript",
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
    "mode-banner",
    "mode-banner-text",
    "mode-banner-dismiss",
    "focus-hint",
    "mode-pill",
    "model-pill",
    "effort-pill",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  let onMessage: Listener | undefined;
  const posted: unknown[] = [];

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
    input,
    sendBtn: elements.get("send")!,
    mentions: elements.get("mentions")!,
    attachments: elements.get("attachments")!,
    attachBtn: elements.get("attach")!,
    attachMenu: elements.get("attach-menu")!,
    toolbarHistory: elements.get("toolbar-history")!,
    toolbarNew: elements.get("toolbar-new")!,
    modeBanner: elements.get("mode-banner")!,
    modeBannerText: elements.get("mode-banner-text")!,
    modeBannerDismiss: elements.get("mode-banner-dismiss")!,
    focusHint: elements.get("focus-hint")!,
    modePill: elements.get("mode-pill")!,
    modelPill: elements.get("model-pill")!,
    effortPill: elements.get("effort-pill")!,
    folder: elements.get("folder")!,
    posted,
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

  test("placeholder names the submit chord", () => {
    const mac = loadChat({ platform: "MacIntel" });
    expect(mac.input.placeholder).toContain("⌘Enter");
    expect(mac.sendBtn.title).toContain("⌘Enter");

    const linux = loadChat({ platform: "Linux x86_64" });
    expect(linux.input.placeholder).toContain("Ctrl+Enter");
    expect(linux.sendBtn.title).toContain("Ctrl+Enter");
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

  test("picking a result adds a context chip and clears the token", () => {
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
    expect(chat.input.value).toBe("see ");
    expect(chat.mentions.hidden).toBe(true);
    expect(chat.attachments.hidden).toBe(false);
    expect(chat.attachments.textContent).toContain("src/chat.js");
  });

  test("submit sends chips as attachments and clears them", () => {
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
    chat.input.value = "see explain this";
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
        prompt: "see explain this",
        attachments: [{ kind: "file", path: "src/chat.js" }],
      },
    ]);
    expect(chat.attachments.hidden).toBe(true);
    expect(chat.input.value).toBe("");
  });

  test("picking the same file twice keeps one chip", () => {
    const chat = loadChat();
    for (const query of ["see @ch", "and @ch"]) {
      chat.input.value = query;
      chat.input.selectionStart = query.length;
      chat.input.dispatch("input");
    }
    chat.send({
      type: "mentionResults",
      requestId: 2,
      items: [{ path: "src/chat.js", source: "open" }],
    });
    chat.mentions.children[0]!.dispatch("mousedown");
    chat.input.value = "more @ch";
    chat.input.selectionStart = 8;
    chat.input.dispatch("input");
    chat.send({
      type: "mentionResults",
      requestId: 3,
      items: [{ path: "src/chat.js", source: "open" }],
    });
    chat.mentions.children[0]!.dispatch("mousedown");
    expect(chat.attachments.children.length).toBe(1);
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
    expect(chat.modePill.textContent).toBe("Mode: Headless");
    expect(chat.modelPill.textContent).toBe("Model: auto");
    expect(chat.effortPill.textContent).toBe("Effort: default");
  });

  test("pills render configured model and effort", () => {
    const chat = loadChat();
    chat.send({
      ...headlessConfig,
      model: "muse-3",
      reasoningEffort: "medium",
    });
    expect(chat.modelPill.textContent).toBe("Model: muse-3");
    expect(chat.effortPill.textContent).toBe("Effort: Medium");
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

  test("toolbar buttons post history and new-session messages", () => {
    const chat = loadChat();
    chat.toolbarHistory.click();
    chat.toolbarNew.click();
    expect(postedTypes(chat)).toEqual(["pickSession", "newSession"]);
  });

  test("pills post cycleMode and openSettings messages", () => {
    const chat = loadChat();
    chat.modePill.click();
    chat.modelPill.click();
    chat.effortPill.click();
    expect(postedTypes(chat)).toEqual([
      "cycleMode",
      "openSettings",
      "openSettings",
    ]);
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
