# Tool Card Progressive Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace always-visible tool-result bodies with configurable one-line disclosure rows that retain every existing detail on demand.

**Architecture:** Keep Muse events and transcript records unchanged. The extension host sends a new `muse.toolDisplay` preference to the existing chat webview; each tool card owns its open/manual-override state, while the webview keeps a registry so configuration changes can update untouched cards. Behavioral tests execute the production `media/chat.js` script in a fake DOM.

**Tech Stack:** TypeScript, Bun test, plain browser JavaScript, VS Code webviews, CSS

---

## File structure

- Create `src/chatWebview.test.ts`: VM-backed behavioral tests for the production chat webview.
- Modify `media/chat.js`: Summary selection, disclosure state, display modes, manual overrides, and history/config behavior.
- Modify `media/chat.css`: One-line disclosure styling, focus treatment, and open-card spacing.
- Modify `src/chatViewProvider.ts`: Send `toolDisplay` with existing chat configuration.
- Modify `src/extension.ts`: Forward `muse.toolDisplay` configuration changes to the chat webview.
- Modify `package.json`: Declare the `muse.toolDisplay` enum and default.
- Modify `README.md`: Document the setting and folded tool-card interaction.
- Modify `CHANGELOG.md`: Record the new compact default under the current release.

## Preflight: preserve the existing working tree

The repository currently contains staged and unstaged work unrelated to this feature. Do not implement on `main` or absorb those changes into feature commits.

- [ ] **Step 1: Inventory the existing state**

Run:

```bash
git status --short
git diff --stat
git diff --cached --stat
```

Expected: existing changes are visible and remain untouched.

- [ ] **Step 2: Protect the existing changes before creating the implementation worktree**

The current staged and unstaged changes must first be committed to their intended
branch or worktree. If their intended ownership is not known, stop and ask the
user; do not stash, reset, discard, or include them in this feature.

Use the `superpowers:using-git-worktrees` skill. The target branch name is:

```text
codex/tool-card-disclosure
```

Expected: the implementation worktree starts clean and includes this plan and its approved design spec.

- [ ] **Step 3: Verify the clean baseline**

Run:

```bash
bun run check
bun run test
```

Expected: TypeScript exits 0 and the existing suite passes before feature work starts.

### Task 1: Lock down compact disclosure behavior

**Files:**
- Create: `src/chatWebview.test.ts`
- Modify: `media/chat.js:19-307`

- [ ] **Step 1: Write the fake-DOM harness and failing compact-mode tests**

Create `src/chatWebview.test.ts`:

```typescript
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
    return this.classList.contains(name) || this.className.split(/\s+/).includes(name);
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
    "transcript", "input", "send", "stop", "history", "session",
    "session-btn", "folder", "setup", "setup-msg", "setup-install",
    "recheck", "docs", "pick-folder",
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
    files: [{ href: "/workspace/CHANGELOG.md", name: "CHANGELOG.md", label: "Document · MD" }],
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
    chat.send(tool({ resultView: "Readable first line", execMeta: { description: "Human description", command: "ignored" } }));
    chat.send(tool({ resultView: "Readable fallback", execMeta: {} }));
    chat.send(tool({ resultView: null, execMeta: { command: "git status" } }));
    chat.send(tool({ name: "search_files", resultView: null, execMeta: {} }));

    const labels = chat.transcript.children.map(
      (card) => card.querySelector(".tool-summary")!.textContent,
    );
    expect(labels).toEqual([
      "Human description",
      "Readable fallback",
      "$ git status",
      "search files",
    ]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test src/chatWebview.test.ts
```

Expected: failures because `.tool-disclosure` and `.tool-details` do not exist and current cards expose their bodies immediately.

- [ ] **Step 3: Add summary and disclosure state to the production webview**

In `media/chat.js`, add the display state beside the existing format state:

```javascript
  let toolOutputFormat = "readable";
  let toolDisplay = "compact";
  let chatFormat = "markdown";
  const toolCards = new Set();
```

Add these helpers before `addToolCard`:

```javascript
  function cleanSummaryLine(text) {
    return String(text || "").replace(/`/g, "").trim();
  }

  function friendlyToolName(name) {
    const value = String(name || "").trim();
    if (!value || /^call[_-][a-z0-9]+$/i.test(value)) {
      return "";
    }
    return value.replace(/[_-]+/g, " ");
  }

  function toolSummary(data) {
    const meta = data.execMeta || {};
    if (meta.description) {
      return cleanSummaryLine(meta.description);
    }
    const readableLine = String(data.resultView || "")
      .split("\n")
      .map(cleanSummaryLine)
      .find(Boolean);
    if (readableLine) {
      return readableLine;
    }
    if (meta.command) {
      return "$ " + truncateOneLine(cleanSummaryLine(meta.command), 80);
    }
    return friendlyToolName(data.name) || "Tool result";
  }

  function shouldOpenToolCard(text) {
    if (toolDisplay === "detailed") return true;
    if (toolDisplay === "compact") return false;
    return text.length <= PREVIEW_CHARS && text.split("\n").length <= PREVIEW_LINES;
  }
```

Replace the header label in `addToolCard` with a real disclosure button:

```javascript
    const disclosureBtn = document.createElement("button");
    disclosureBtn.type = "button";
    disclosureBtn.className = "tool-disclosure";

    const chevron = document.createElement("span");
    chevron.className = "tool-chevron";
    chevron.setAttribute("aria-hidden", "true");
    disclosureBtn.appendChild(chevron);

    const label = document.createElement("span");
    label.className = "label tool-summary";
    label.textContent = toolSummary(data);
    disclosureBtn.appendChild(label);
    header.appendChild(disclosureBtn);
```

Create a details wrapper after the action buttons, and append the body and file chips to it:

```javascript
    const details = document.createElement("div");
    details.className = "tool-details";

    const body = document.createElement("pre");
    body.className = "tool-body";
    details.appendChild(body);
    appendFileChips(details, data.files);
    el.appendChild(details);
```

Replace the final card-render block with disclosure state:

```javascript
    let cardOpen = shouldOpenToolCard(activeText());
    let manualDisclosure = false;

    function renderDisclosure() {
      disclosureBtn.setAttribute("aria-expanded", cardOpen ? "true" : "false");
      chevron.textContent = cardOpen ? "▾" : "▸";
      el.classList.toggle("open", cardOpen);
      actions.hidden = !cardOpen;
      details.hidden = !cardOpen;
      renderBody();
    }

    const controller = {
      applyDisplay() {
        if (manualDisclosure) return;
        cardOpen = shouldOpenToolCard(activeText());
        renderDisclosure();
      },
    };
    toolCards.add(controller);

    disclosureBtn.addEventListener("click", function () {
      manualDisclosure = true;
      cardOpen = !cardOpen;
      renderDisclosure();
      scrollBottom();
    });

    header.appendChild(expandBtn);
    renderDisclosure();
    transcript.appendChild(el);
```

In `renderBody`, keep the secondary output-expansion button hidden while the card is folded:

```javascript
      expandBtn.hidden = !cardOpen || !needsExpand;
```

In `clearTranscript`, clear detached card controllers:

```javascript
  function clearTranscript() {
    transcript.innerHTML = "";
    toolCards.clear();
    assistantEl = null;
  }
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
bun test src/chatWebview.test.ts
```

Expected: 4 tests pass, 0 fail.

- [ ] **Step 5: Commit compact disclosure behavior**

```bash
git add media/chat.js src/chatWebview.test.ts
git commit -m "Add compact tool card disclosure"
```

### Task 2: Add Balanced, Detailed, config updates, and History behavior

**Files:**
- Modify: `src/chatWebview.test.ts`
- Modify: `media/chat.js:430-455`

- [ ] **Step 1: Add failing mode and lifecycle tests**

Append to the existing `describe` block in `src/chatWebview.test.ts`:

```typescript
  test("balanced opens short output and folds long output", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "balanced" });
    chat.send(tool({ resultView: "short output" }));
    chat.send(tool({ resultView: Array.from({ length: 13 }, (_, i) => `line ${i}`).join("\n") }));
    chat.send(tool({ resultView: "x".repeat(801) }));

    expect(chat.transcript.children[0].querySelector(".tool-details")!.hidden).toBe(false);
    expect(chat.transcript.children[1].querySelector(".tool-details")!.hidden).toBe(true);
    expect(chat.transcript.children[2].querySelector(".tool-details")!.hidden).toBe(true);
  });

  test("detailed opens long output", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "detailed" });
    chat.send(tool({ resultView: "x".repeat(900) }));
    expect(chat.transcript.children[0].querySelector(".tool-details")!.hidden).toBe(false);
  });

  test("config changes update only cards without a manual override", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send(tool());
    chat.send(tool({ execMeta: { description: "Second tool", exitCode: 0 } }));
    chat.transcript.children[0].querySelector(".tool-disclosure")!.click();

    chat.send({ type: "config", toolDisplay: "detailed" });
    expect(chat.transcript.children[0].querySelector(".tool-details")!.hidden).toBe(false);
    expect(chat.transcript.children[1].querySelector(".tool-details")!.hidden).toBe(false);

    chat.send({ type: "config", toolDisplay: "compact" });
    expect(chat.transcript.children[0].querySelector(".tool-details")!.hidden).toBe(false);
    expect(chat.transcript.children[1].querySelector(".tool-details")!.hidden).toBe(true);
  });

  test("History rebuild applies the current display setting afresh", () => {
    const chat = loadChat();
    chat.send({ type: "config", toolDisplay: "detailed" });
    chat.send({ type: "history", items: [tool()] });
    expect(chat.transcript.children[0].querySelector(".tool-details")!.hidden).toBe(false);

    chat.send({ type: "config", toolDisplay: "compact" });
    chat.send({ type: "history", items: [tool()] });
    expect(chat.transcript.children[0].querySelector(".tool-details")!.hidden).toBe(true);
  });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test src/chatWebview.test.ts
```

Expected: mode/config tests fail because `toolDisplay` is not yet read from config and existing cards are not updated.

- [ ] **Step 3: Handle the display setting in the webview config message**

In the `config` case in `media/chat.js`, add:

```javascript
        if (
          msg.toolDisplay === "compact" ||
          msg.toolDisplay === "balanced" ||
          msg.toolDisplay === "detailed"
        ) {
          toolDisplay = msg.toolDisplay;
          toolCards.forEach(function (card) {
            card.applyDisplay();
          });
        }
```

No History-specific implementation is needed beyond the existing
`renderHistory()` → `clearTranscript()` → `addToolCard()` flow: clearing removes
manual state and new cards read the current setting.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
bun test src/chatWebview.test.ts
```

Expected: 8 tests pass, 0 fail.

- [ ] **Step 5: Commit display modes and lifecycle behavior**

```bash
git add media/chat.js src/chatWebview.test.ts
git commit -m "Add tool card display modes"
```

### Task 3: Wire the VS Code setting and finish the presentation

**Files:**
- Modify: `media/chat.css:274-355`
- Modify: `src/chatViewProvider.ts:133-143`
- Modify: `src/extension.ts:59-66`
- Modify: `package.json:243-260`
- Modify: `README.md:77-96`
- Modify: `CHANGELOG.md:3-8`

- [ ] **Step 1: Add the setting declaration**

In `package.json`, insert after `muse.toolOutputFormat`:

```json
        "muse.toolDisplay": {
          "type": "string",
          "enum": [
            "compact",
            "balanced",
            "detailed"
          ],
          "enumDescriptions": [
            "Fold every tool result to a one-line summary.",
            "Open short tool results and fold long results.",
            "Open every tool result."
          ],
          "default": "compact",
          "description": "How tool results are initially disclosed in chat. Every card can still be opened or folded individually."
        },
```

- [ ] **Step 2: Send and refresh the setting from the extension host**

In `ChatViewProvider.postConfig()`, add the field:

```typescript
      toolDisplay: cfg.get<"compact" | "balanced" | "detailed">(
        "toolDisplay",
        "compact",
      ),
```

In `src/extension.ts`, extend the chat configuration condition:

```typescript
      if (
        e.affectsConfiguration("muse.toolOutputFormat") ||
        e.affectsConfiguration("muse.toolDisplay") ||
        e.affectsConfiguration("muse.chatFormat")
      ) {
        provider.postConfig();
        canvasPanel.postConfig();
      }
```

- [ ] **Step 3: Style the disclosure row and open details**

In `media/chat.css`, replace the label-only flex rule with:

```css
.tool-disclosure {
  flex: 1 1 240px;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.tool-disclosure:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}

.tool-chevron {
  flex: 0 0 auto;
  width: 1em;
  opacity: 0.75;
}

.tool-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-header .label {
  margin-bottom: 0;
}

.tool-card.open .tool-header {
  margin-bottom: 6px;
}

.tool-details[hidden],
.tool-actions[hidden] {
  display: none;
}
```

Change `.tool-header` from `margin-bottom: 6px` to `margin-bottom: 0` so folded
rows remain one line.

- [ ] **Step 4: Document the user-facing behavior**

Add this row to the README settings table:

```markdown
| `toolDisplay` | `compact` | Initial tool-card disclosure: `compact` folds all results, `balanced` opens only short results, and `detailed` opens all results. |
```

Replace the tool-card paragraph with:

```markdown
Tool calls appear as one-line disclosure rows by default. Open a row to reveal
Readable / Raw output, file chips, and **Open in canvas**. The `toolDisplay`
setting chooses Compact, Balanced, or Detailed initial disclosure; failed calls
remain folded with a red exit badge until opened.
```

Under the current release's `### Changed` section in `CHANGELOG.md`, add:

```markdown
- Tool results now default to compact one-line disclosure rows, with
  `muse.toolDisplay` settings for Compact, Balanced, and Detailed presentation
```

- [ ] **Step 5: Run focused and complete verification**

Run:

```bash
bun test src/chatWebview.test.ts
bun run check
bun run test
bun run compile:prod
git diff --check
```

Expected: all focused tests pass, TypeScript exits 0, the full suite passes, the
production bundle builds, and no whitespace errors are reported.

- [ ] **Step 6: Commit setting, styles, and documentation**

```bash
git add media/chat.css src/chatViewProvider.ts src/extension.ts package.json README.md CHANGELOG.md
git commit -m "Add configurable tool card verbosity"
```

### Task 4: Review the complete branch

**Files:**
- Review: all files changed from the implementation base to `HEAD`

- [ ] **Step 1: Inspect the final diff**

Run:

```bash
git diff --stat main...HEAD
git diff --check main...HEAD
git status --short
```

Expected: only planned files are changed, whitespace is clean, and the feature
worktree has no uncommitted changes.

- [ ] **Step 2: Request independent code review**

Use `superpowers:requesting-code-review` with the approved design spec and this
plan as requirements. Resolve every Critical or Important finding before
integration.

- [ ] **Step 3: Re-run the final gate after review fixes**

Run:

```bash
bun run check
bun run test
bun run compile:prod
```

Expected: all commands exit 0 with no test failures.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch` to choose local merge, pull
request, branch preservation, or discard. Do not merge into a dirty `main`;
reconcile the pre-existing working-tree changes first.
