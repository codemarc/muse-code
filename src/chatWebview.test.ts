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

  set scrollTop(_value: number) {}

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

function loadChat() {
  const ids = [
    "transcript",
    "input",
    "send",
    "stop",
    "history",
    "session",
    "session-btn",
    "folder",
    "setup",
    "setup-msg",
    "setup-install",
    "recheck",
    "docs",
    "pick-folder",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  let onMessage: Listener | undefined;

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
    acquireVsCodeApi: () => ({ postMessage: () => undefined }),
    document,
    window,
  });

  return {
    transcript: elements.get("transcript")!,
    send(data: unknown) {
      if (!onMessage) throw new Error("chat message listener was not installed");
      onMessage({ data });
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
});
