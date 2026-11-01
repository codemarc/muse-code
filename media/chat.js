(function () {
  const vscode = acquireVsCodeApi();
  const transcript = document.getElementById("transcript");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const stopBtn = document.getElementById("stop");
  const historyBtn = document.getElementById("history");
  const sessionEl = document.getElementById("session");
  const sessionBtn = document.getElementById("session-btn");
  const folderEl = document.getElementById("folder");
  const executionModeEl = document.getElementById("execution-mode");
  const setupEl = document.getElementById("setup");
  const setupMsg = document.getElementById("setup-msg");
  const setupInstall = document.getElementById("setup-install");
  const recheckBtn = document.getElementById("recheck");
  const docsBtn = document.getElementById("docs");
  const museAiBtn = document.getElementById("muse-ai");
  const pickFolderBtn = document.getElementById("pick-folder");
  const mentionsEl = document.getElementById("mentions");
  const attachmentsEl = document.getElementById("attachments");
  const attachBtn = document.getElementById("attach");
  const attachMenu = document.getElementById("attach-menu");
  const toolbarHistoryBtn = document.getElementById("toolbar-history");
  const toolbarNewBtn = document.getElementById("toolbar-new");
  const modeBanner = document.getElementById("mode-banner");
  const modeBannerText = document.getElementById("mode-banner-text");
  const modeBannerDismiss = document.getElementById("mode-banner-dismiss");
  const focusHint = document.getElementById("focus-hint");
  const modePill = document.getElementById("mode-pill");
  const modelPill = document.getElementById("model-pill");
  const effortPill = document.getElementById("effort-pill");

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || "");
  const submitChord = isMac ? "⌘Enter" : "Ctrl+Enter";
  input.placeholder =
    "Ask Muse… (@ attach file, " + submitChord + " to send)";
  sendBtn.title = "Send (" + submitChord + ")";
  if (focusHint) {
    focusHint.textContent = isMac
      ? "⌘ Esc to focus or unfocus Muse"
      : "Esc to unfocus · click to focus Muse";
  }

  const PREVIEW_LINES = 12;
  const PREVIEW_CHARS = 800;
  const EXPANDED_CHARS = 8000;

  let running = false;
  let museReady = false;
  let assistantEl = null;
  let toolOutputFormat = "readable";
  let toolDisplay = "compact";
  let chatFormat = "markdown";
  const toolCards = new Set();
  let silentToolRuns = 0;
  const MINIMAL_HEARTBEAT_EVERY = 5;
  let mentionItems = [];
  let mentionIndex = 0;
  let mentionRequestId = 0;
  let mentionToken = null;
  let attachments = [];
  let currentFileRequestId = 0;
  let dismissedBannerMode = null;
  let currentExecutionMode = null;

  // keep in sync with canvas.js:LINK_RE and previewContent.ts:DOC_PATH_SOURCE
  const LINK_RE =
    /(?:(?:https?:\/\/|file:\/\/)[^\s<>"']+|(?<![\w.~/-])\/?(?:[\w.~-]+\/)*[\w.~-]+\.(?:html?|pdf|markdown|md|jsonl?|ya?ml|toon|csv|tsv|txt|xlsx?|svg|png|jpe?g|gif|webp)(?![A-Za-z0-9]))/gi;

  function scrollBottom() {
    transcript.scrollTop = transcript.scrollHeight;
  }

  /**
   * Render chips for files the extension host verified exist on disk.
   * `files` items are { href, name, label }.
   */
  function appendFileChips(parent, files) {
    if (!files || !files.length) {
      return;
    }
    const row = document.createElement("div");
    row.className = "file-chips";
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file || !file.href) {
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "file-chip";
      btn.title = file.href;
      const name = document.createElement("span");
      name.className = "file-chip-name";
      name.textContent = file.name || file.href;
      const meta = document.createElement("span");
      meta.className = "file-chip-meta";
      meta.textContent = file.label || "Document";
      btn.appendChild(name);
      btn.appendChild(meta);
      btn.addEventListener("click", function () {
        vscode.postMessage({ type: "openCanvasFile", href: file.href });
      });
      row.appendChild(btn);
    }
    if (row.childNodes.length) {
      parent.appendChild(row);
    }
  }

  function attachmentLabel(a) {
    if (!a) {
      return "";
    }
    if (a.kind === "file") {
      return a.path || "file";
    }
    if (a.kind === "problems") {
      return "Problems";
    }
    if (a.kind === "terminal") {
      return "Terminal";
    }
    if (a.kind === "editors") {
      return "Open editors";
    }
    return String(a.label || a.kind || "context");
  }

  function attachmentKey(a) {
    return a.kind === "file" ? "file:" + (a.path || "") : String(a.kind);
  }

  function addAttachment(a) {
    if (!a || !a.kind) {
      return;
    }
    if (a.kind === "file" && !a.path) {
      return;
    }
    const key = attachmentKey(a);
    for (let i = 0; i < attachments.length; i++) {
      if (attachmentKey(attachments[i]) === key) {
        return;
      }
    }
    if (attachments.length >= 16) {
      return;
    }
    attachments.push(a.kind === "file" ? { kind: "file", path: a.path } : { kind: a.kind });
    renderAttachments();
  }

  function removeAttachment(index) {
    attachments.splice(index, 1);
    renderAttachments();
  }

  function clearAttachments() {
    attachments = [];
    renderAttachments();
  }

  function renderAttachments() {
    if (!attachmentsEl) {
      return;
    }
    attachmentsEl.textContent = "";
    if (!attachments.length) {
      attachmentsEl.hidden = true;
      return;
    }
    attachmentsEl.hidden = false;
    for (let i = 0; i < attachments.length; i++) {
      (function (item, index) {
        const chip = document.createElement("span");
        chip.className = "ctx-chip";
        chip.title = item.kind === "file" ? "Attached file contents: " + item.path : "Attached: " + attachmentLabel(item);
        const label = document.createElement("span");
        label.className = "ctx-chip-label";
        label.textContent = attachmentLabel(item);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ctx-chip-remove";
        remove.textContent = "×";
        remove.title = "Remove";
        remove.setAttribute("aria-label", "Remove " + attachmentLabel(item));
        remove.addEventListener("click", function () {
          removeAttachment(index);
        });
        chip.appendChild(label);
        chip.appendChild(remove);
        attachmentsEl.appendChild(chip);
      })(attachments[i], i);
    }
  }

  // Read-only chips shown on user messages (live + history).
  function appendContextChips(parent, attached) {
    if (!attached || !attached.length) {
      return;
    }
    const row = document.createElement("div");
    row.className = "ctx-row";
    for (let i = 0; i < attached.length; i++) {
      const chip = document.createElement("span");
      chip.className = "ctx-chip ctx-chip-static";
      chip.textContent = String(attached[i]);
      row.appendChild(chip);
    }
    parent.appendChild(row);
  }

  function resetSilentToolRuns() {
    silentToolRuns = 0;
  }

  function noteSilentToolRun() {
    silentToolRuns += 1;
    if (silentToolRuns >= MINIMAL_HEARTBEAT_EVERY) {
      silentToolRuns = 0;
      addMsg("status heartbeat", "working…");
    }
  }

  function addMsg(className, text, label, linkify, html, files) {
    resetSilentToolRuns();
    const el = document.createElement("div");
    el.className = "msg " + className;
    if (label) {
      const lab = document.createElement("span");
      lab.className = "label";
      lab.textContent = label;
      el.appendChild(lab);
    }
    const body = document.createElement("div");
    body.className = "body";
    if (className === "assistant" && html && chatFormat === "markdown") {
      body.classList.add("md-body");
      body.style.whiteSpace = "normal";
      body.innerHTML = html;
    } else if (linkify) {
      linkifyInto(body, text || "");
    } else {
      body.textContent = text;
    }
    el.appendChild(body);
    appendFileChips(el, files);
    transcript.appendChild(el);
    scrollBottom();
    return el;
  }

  function countChar(text, ch) {
    let n = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === ch) {
        n += 1;
      }
    }
    return n;
  }

  // keep in sync with src/linkTarget.ts:trimLinkEnd
  function trimLinkEnd(href) {
    const closers = { ")": "(", "]": "[", "}": "{" };
    let out = href;
    for (let guard = 0; guard < 8; guard += 1) {
      const stripped = out.replace(/[.,;:!?'"*`>]+$/, "");
      if (stripped !== out) {
        out = stripped;
        continue;
      }
      const last = out.slice(-1);
      const opener = closers[last];
      if (opener && countChar(out, last) > countChar(out, opener)) {
        out = out.slice(0, -1);
        continue;
      }
      break;
    }
    return out;
  }

  function linkifyInto(el, text) {
    el.textContent = "";
    if (!text) {
      return;
    }
    let lastIndex = 0;
    const re = new RegExp(LINK_RE.source, "gi");
    let match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        el.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const href = trimLinkEnd(match[0]);
      lastIndex = re.lastIndex;
      if (!href) {
        el.appendChild(document.createTextNode(match[0]));
        continue;
      }
      const a = document.createElement("a");
      a.href = href;
      a.textContent = href;
      a.className = "tool-link";
      a.addEventListener("click", function (e) {
        e.preventDefault();
        vscode.postMessage({ type: "openLink", href: href });
      });
      el.appendChild(a);
      // Punctuation trimmed off the match stays in the surrounding text.
      lastIndex = match.index + href.length;
    }
    if (lastIndex < text.length) {
      el.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function collapsePreview(text) {
    if (text.length <= PREVIEW_CHARS) {
      const lines = text.split("\n");
      if (lines.length <= PREVIEW_LINES) {
        return text;
      }
      return lines.slice(0, PREVIEW_LINES).join("\n") + "\n…";
    }
    return text.slice(0, PREVIEW_CHARS) + "…";
  }

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

  function isGenericSummary(text) {
    return /^tool result$/i.test(String(text || "").trim());
  }

  function firstContentLine(text) {
    return (
      String(text || "")
        .split("\n")
        .map(cleanSummaryLine)
        .find(function (line) {
          return (
            line &&
            !isGenericSummary(line) &&
            line !== "{" &&
            line !== "}" &&
            line !== "[" &&
            line !== "]"
          );
        }) || ""
    );
  }

  function toolSummary(data) {
    const meta = data.execMeta || {};
    if (meta.description) {
      return cleanSummaryLine(meta.description);
    }
    const readableLine = firstContentLine(data.resultView);
    if (readableLine) {
      return readableLine;
    }
    if (meta.command) {
      return "$ " + truncateOneLine(cleanSummaryLine(meta.command), 80);
    }
    const name = friendlyToolName(data.name);
    if (name && !isGenericSummary(name)) {
      return name;
    }
    const contentLine = firstContentLine(data.resultRaw);
    if (contentLine) {
      return truncateOneLine(contentLine, 80);
    }
    return name || "Tool result";
  }

  function looksRawSummary(text) {
    return /^[<{\[]/.test(String(text || "").trim());
  }

  function minimalSummary(data) {
    const meta = data.execMeta || {};
    if (meta.description) {
      return cleanSummaryLine(meta.description);
    }
    const name = friendlyToolName(data.name);
    if (name && !isGenericSummary(name) && !looksRawSummary(name)) {
      return name;
    }
    if (meta.command) {
      return "$ " + truncateOneLine(cleanSummaryLine(meta.command), 80);
    }
    const line =
      firstContentLine(data.resultView) || firstContentLine(data.resultRaw);
    if (line && !looksRawSummary(line)) {
      return truncateOneLine(line, 80);
    }
    return "";
  }

  function shouldOpenToolCard(text) {
    if (toolDisplay === "detailed") {
      return true;
    }
    if (toolDisplay === "compact" || toolDisplay === "minimal") {
      return false;
    }
    return (
      text.length <= PREVIEW_CHARS && text.split("\n").length <= PREVIEW_LINES
    );
  }

  function addToolCard(data) {
    const meta = data.execMeta || {};
    const failed =
      meta.exitCode !== undefined &&
      meta.exitCode !== null &&
      meta.exitCode !== 0;
    if (toolDisplay === "minimal" && !failed && !minimalSummary(data)) {
      noteSilentToolRun();
      return null;
    }
    resetSilentToolRuns();

    const el = document.createElement("div");
    el.className = "msg tool tool-card";

    const header = document.createElement("div");
    header.className = "tool-header";

    const disclosureBtn = document.createElement("button");
    disclosureBtn.type = "button";
    disclosureBtn.className = "tool-disclosure";

    const chevron = document.createElement("span");
    chevron.className = "tool-chevron";
    chevron.setAttribute("aria-hidden", "true");
    disclosureBtn.appendChild(chevron);

    const label = document.createElement("span");
    label.className = "label tool-summary";
    disclosureBtn.appendChild(label);
    header.appendChild(disclosureBtn);

    let badge = null;
    if (meta.exitCode !== undefined && meta.exitCode !== null) {
      badge = document.createElement("span");
      badge.className =
        "tool-exit " + (meta.exitCode === 0 ? "tool-exit-ok" : "tool-exit-fail");
      badge.textContent = "exit " + meta.exitCode;
      header.appendChild(badge);
    }

    const actions = document.createElement("div");
    actions.className = "tool-actions";

    const hasReadable = !!data.resultView;
    let mode = hasReadable ? toolOutputFormat : "json";
    let expanded = false;

    const readableBtn = document.createElement("button");
    readableBtn.type = "button";
    readableBtn.className = "tool-toggle";
    readableBtn.textContent = "Readable";
    readableBtn.hidden = !hasReadable;

    const rawBtn = document.createElement("button");
    rawBtn.type = "button";
    rawBtn.className = "tool-toggle";
    rawBtn.textContent = "Raw";

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "tool-toggle";
    expandBtn.hidden = true;

    const openCanvasBtn = document.createElement("button");
    openCanvasBtn.type = "button";
    openCanvasBtn.className = "tool-toggle";
    openCanvasBtn.textContent = "Open in canvas";
    const hasContent = !!(data.resultRaw || data.resultView);
    openCanvasBtn.hidden = !hasContent;
    openCanvasBtn.addEventListener("click", function () {
      vscode.postMessage({
        type: "openCanvas",
        payload: {
          name: data.name,
          resultRaw: data.resultRaw,
          resultView: data.resultView,
          execMeta: data.execMeta,
        },
      });
    });

    actions.appendChild(readableBtn);
    actions.appendChild(rawBtn);
    actions.appendChild(openCanvasBtn);
    header.appendChild(actions);
    el.appendChild(header);

    const details = document.createElement("div");
    details.className = "tool-details";

    const body = document.createElement("pre");
    body.className = "tool-body";
    details.appendChild(body);
    appendFileChips(details, data.files);
    el.appendChild(details);

    function activeText() {
      if (mode === "readable" && data.resultView) {
        return data.resultView;
      }
      return data.resultRaw || "";
    }

    function syncToggleState() {
      readableBtn.classList.toggle("active", mode === "readable");
      rawBtn.classList.toggle("active", mode === "json");
    }

    function minimalLabel() {
      return minimalSummary(data) || (failed ? toolSummary(data) : "");
    }

    function renderMinimalDisplay() {
      const minimal = toolDisplay === "minimal";
      el.classList.toggle("tool-minimal", minimal);
      el.classList.toggle("tool-minimal-fail", minimal && failed);
      label.textContent = minimal ? minimalLabel() : toolSummary(data);
      el.hidden = minimal && !failed && !label.textContent;
      chevron.hidden = minimal && !failed;
      if (badge) {
        badge.hidden = minimal && !failed;
      }
    }

    let cardOpen = shouldOpenToolCard(activeText());
    let manualDisclosure = false;

    function renderBody() {
      const full = activeText();
      const needsExpand =
        full.length > PREVIEW_CHARS || full.split("\n").length > PREVIEW_LINES;
      expandBtn.hidden = !cardOpen || !needsExpand;

      let display = full;
      if (!expanded) {
        display = collapsePreview(full);
      } else if (full.length > EXPANDED_CHARS) {
        display = full.slice(0, EXPANDED_CHARS) + "…";
      }

      body.textContent = "";
      linkifyInto(body, display);
      expandBtn.textContent = expanded ? "Collapse" : "Expand";
      syncToggleState();
    }

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
        renderMinimalDisplay();
        if (manualDisclosure) {
          return;
        }
        cardOpen = shouldOpenToolCard(activeText());
        renderDisclosure();
      },
      setOpen(open) {
        if (open && toolDisplay === "minimal" && !failed) {
          return;
        }
        manualDisclosure = true;
        cardOpen = open;
        if (!open) {
          expanded = false;
        }
        renderDisclosure();
      },
    };
    toolCards.add(controller);

    readableBtn.addEventListener("click", function () {
      if (!hasReadable) {
        return;
      }
      mode = "readable";
      renderBody();
    });
    rawBtn.addEventListener("click", function () {
      mode = "json";
      renderBody();
    });
    expandBtn.addEventListener("click", function () {
      expanded = !expanded;
      renderBody();
    });
    disclosureBtn.addEventListener("click", function () {
      if (toolDisplay === "minimal" && !failed) {
        return;
      }
      manualDisclosure = true;
      cardOpen = !cardOpen;
      renderDisclosure();
    });

    header.appendChild(expandBtn);
    renderMinimalDisplay();
    renderDisclosure();

    transcript.appendChild(el);
    scrollBottom();
    return el;
  }

  function truncateOneLine(s, n) {
    if (s.length <= n) {
      return s;
    }
    return s.slice(0, n) + "…";
  }

  function clearTranscript() {
    transcript.innerHTML = "";
    toolCards.clear();
    assistantEl = null;
    resetSilentToolRuns();
  }

  function renderHistory(items) {
    clearTranscript();
    if (!items || !items.length) {
      return;
    }
    for (const item of items) {
      switch (item.type) {
        case "user": {
          const el = addMsg("user", item.text || "");
          appendContextChips(el, item.attached);
          break;
        }
        case "assistant":
          addMsg(
            "assistant",
            item.text || "",
            "Muse",
            false,
            item.html || null,
            item.files,
          );
          break;
        case "tool":
          addToolCard(item);
          break;
        case "task":
          addMsg("task", item.text || "", "task");
          break;
        case "status":
          addMsg("status", item.text || "", "status");
          break;
        case "error":
          addMsg("error", item.text || "", "error");
          break;
        default:
          break;
      }
    }
    assistantEl = null;
  }

  function setRunning(value) {
    running = value;
    sendBtn.disabled = value || !museReady;
    stopBtn.disabled = !value;
    input.disabled = value || !museReady;
    historyBtn.disabled = value;
    sessionBtn.disabled = value;
  }

  function setSetup(msg) {
    museReady = !!msg.ok;
    if (museReady) {
      setupEl.hidden = true;
      pickFolderBtn.hidden = true;
      setRunning(running);
      return;
    }
    setupEl.hidden = false;
    setupMsg.textContent = msg.message || "Muse CLI is not ready.";
    setupInstall.textContent = msg.installHint || "";
    setupInstall.hidden = !msg.installHint;
    pickFolderBtn.hidden = !msg.needsFolderPick;
    setRunning(running);
  }

  function formatModelPill(model) {
    const trimmed = String(model || "").trim();
    return trimmed || "auto";
  }

  function formatEffortPill(effort) {
    const trimmed = String(effort || "").trim().toLowerCase();
    if (!trimmed) {
      return "default";
    }
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  function renderModeBanner(msg) {
    if (!modeBanner || !modeBannerText) {
      return;
    }
    currentExecutionMode = msg.executionMode || null;
    const label = msg.executionModeLabel || "Headless";
    if (dismissedBannerMode === msg.executionMode) {
      modeBanner.hidden = true;
      return;
    }
    const desc = msg.executionModeDescription || "";
    modeBannerText.textContent = desc
      ? label + " mode active — " + desc
      : label + " mode active.";
    modeBanner.hidden = false;
  }

  function renderPills(msg) {
    if (modePill && msg.executionModeLabel) {
      modePill.textContent = "Mode: " + msg.executionModeLabel;
      modePill.title = msg.executionModeDescription || "Switch execution mode";
    }
    if (modelPill && msg.model !== undefined) {
      modelPill.textContent = "Model: " + formatModelPill(msg.model);
    }
    if (effortPill && msg.reasoningEffort !== undefined) {
      effortPill.textContent = "Effort: " + formatEffortPill(msg.reasoningEffort);
    }
  }

  function ensureAssistant() {
    if (!assistantEl) {
      assistantEl = addMsg("assistant", "", "Muse");
    }
    return assistantEl.querySelector(".body");
  }

  function submit() {
    const prompt = input.value.trim();
    if ((!prompt && !attachments.length) || running || !museReady) {
      return;
    }
    hideMentions();
    hideAttachMenu();
    assistantEl = null;
    vscode.postMessage({
      type: "submit",
      prompt: prompt,
      attachments: attachments.map(function (a) {
        return a.kind === "file" ? { kind: "file", path: a.path } : { kind: a.kind };
      }),
    });
    input.value = "";
    clearAttachments();
  }

  function pickSession() {
    if (running) {
      return;
    }
    vscode.postMessage({ type: "pickSession" });
  }

  // keep in sync with src/fileMentions.ts
  function mentionQueryAt(text, cursor) {
    const before = text.slice(0, Math.max(0, cursor));
    const match = before.match(/@[A-Za-z0-9_./-]*$/);
    if (!match || match.index == null) {
      return null;
    }
    const start = match.index;
    if (start > 0 && !/\s/.test(before.charAt(start - 1))) {
      return null;
    }
    return { start: start, end: cursor, query: match[0].slice(1) };
  }

  function hideMentions() {
    mentionItems = [];
    mentionIndex = 0;
    mentionToken = null;
    if (mentionsEl) {
      mentionsEl.hidden = true;
      mentionsEl.textContent = "";
    }
  }

  function applyMention(path) {
    const cursor =
      typeof input.selectionStart === "number"
        ? input.selectionStart
        : input.value.length;
    const token = mentionToken || mentionQueryAt(input.value, cursor);
    if (!token) {
      hideMentions();
      return;
    }
    // Cursor-style: the pick becomes a context chip (contents attached at
    // send time) instead of a bare path in the prompt text.
    input.value = input.value.slice(0, token.start) + input.value.slice(token.end);
    const nextCursor = token.start;
    input.selectionStart = nextCursor;
    input.selectionEnd = nextCursor;
    addAttachment({ kind: "file", path: path });
    hideMentions();
    if (typeof input.focus === "function") {
      input.focus();
    }
  }

  function hideAttachMenu() {
    if (attachMenu) {
      attachMenu.hidden = true;
    }
  }

  function toggleAttachMenu() {
    if (!attachMenu) {
      return;
    }
    attachMenu.hidden = !attachMenu.hidden;
  }

  function requestCurrentFile() {
    currentFileRequestId += 1;
    vscode.postMessage({
      type: "currentFileQuery",
      requestId: currentFileRequestId,
    });
  }

  function renderMentions(items) {
    if (!mentionsEl) {
      return;
    }
    mentionItems = items || [];
    mentionIndex = 0;
    mentionsEl.textContent = "";
    if (!mentionItems.length) {
      mentionsEl.hidden = true;
      return;
    }
    mentionsEl.hidden = false;
    for (let i = 0; i < mentionItems.length; i++) {
      const item = mentionItems[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mention-item" + (i === 0 ? " active" : "");
      btn.setAttribute("data-path", item.path);
      btn.textContent = item.path + " · " + (item.source || "file");
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        applyMention(item.path);
      });
      mentionsEl.appendChild(btn);
    }
  }

  function highlightMention(index) {
    if (!mentionsEl || !mentionItems.length) {
      return;
    }
    mentionIndex = (index + mentionItems.length) % mentionItems.length;
    const buttons = mentionsEl.querySelectorAll
      ? mentionsEl.querySelectorAll(".mention-item")
      : mentionsEl.children;
    for (let i = 0; i < buttons.length; i++) {
      const el = buttons[i];
      if (!el || !el.classList) {
        continue;
      }
      if (i === mentionIndex) {
        el.classList.add("active");
      } else {
        el.classList.toggle("active", false);
      }
    }
  }

  function requestMentions() {
    const cursor =
      typeof input.selectionStart === "number"
        ? input.selectionStart
        : input.value.length;
    const token = mentionQueryAt(input.value, cursor);
    mentionToken = token;
    if (!token) {
      hideMentions();
      return;
    }
    mentionRequestId += 1;
    vscode.postMessage({
      type: "mentionQuery",
      query: token.query,
      requestId: mentionRequestId,
    });
  }

  function addChangesCard(msg) {
    const files = msg.files || [];
    const lines = files.map(function (file) {
      const status = file.status === "??" ? "untracked" : file.status || "M";
      return (file.path || "") + " (" + status + ")";
    });
    const el = addMsg(
      "changes",
      lines.join("\n") || "Working tree changed.",
      "Changed files",
    );
    const actions = document.createElement("div");
    actions.className = "changes-actions";
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "secondary";
    openBtn.textContent = "Open diff";
    openBtn.addEventListener("click", function () {
      vscode.postMessage({
        type: "openCanvas",
        payload: {
          name: "Changed files",
          resultView: msg.markdown || "",
          resultRaw: msg.markdown || "",
        },
      });
    });
    actions.appendChild(openBtn);
    el.appendChild(actions);
  }

  sendBtn.addEventListener("click", submit);
  stopBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "stop" });
  });
  historyBtn.addEventListener("click", pickSession);
  sessionBtn.addEventListener("click", pickSession);
  if (toolbarHistoryBtn) {
    toolbarHistoryBtn.addEventListener("click", pickSession);
  }
  if (toolbarNewBtn) {
    toolbarNewBtn.addEventListener("click", function () {
      if (running) {
        return;
      }
      vscode.postMessage({ type: "newSession" });
    });
  }
  if (modeBannerDismiss) {
    modeBannerDismiss.addEventListener("click", function () {
      dismissedBannerMode = currentExecutionMode;
      if (modeBanner) {
        modeBanner.hidden = true;
      }
    });
  }
  if (modePill) {
    modePill.addEventListener("click", function () {
      vscode.postMessage({ type: "cycleMode" });
    });
  }
  if (modelPill) {
    modelPill.addEventListener("click", function () {
      vscode.postMessage({ type: "openSettings" });
    });
  }
  if (effortPill) {
    effortPill.addEventListener("click", function () {
      vscode.postMessage({ type: "openSettings" });
    });
  }
  recheckBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "recheck" });
  });
  docsBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "openDocs" });
  });
  if (museAiBtn) {
    museAiBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "openMuseAi" });
    });
  }
  pickFolderBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "selectFolder" });
  });
  if (attachBtn) {
    attachBtn.addEventListener("click", function () {
      toggleAttachMenu();
    });
  }
  if (attachMenu) {
    const items = attachMenu.querySelectorAll
      ? attachMenu.querySelectorAll("[data-attach]")
      : [];
    for (let i = 0; i < items.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          const kind = btn.getAttribute ? btn.getAttribute("data-attach") : null;
          hideAttachMenu();
          if (kind === "file") {
            if (typeof input.focus === "function") {
              input.focus();
            }
            const cursor =
              typeof input.selectionStart === "number"
                ? input.selectionStart
                : input.value.length;
            const needsSpace = cursor > 0 && !/\s/.test(input.value.charAt(cursor - 1));
            const insert = (needsSpace ? " " : "") + "@";
            input.value =
              input.value.slice(0, cursor) + insert + input.value.slice(cursor);
            const next = cursor + insert.length;
            input.selectionStart = next;
            input.selectionEnd = next;
            requestMentions();
            return;
          }
          if (kind === "current") {
            requestCurrentFile();
            return;
          }
          if (kind === "editors" || kind === "problems" || kind === "terminal") {
            addAttachment({ kind: kind });
          }
        });
      })(items[i]);
    }
  }

  input.addEventListener("input", requestMentions);
  input.addEventListener("keyup", function (e) {
    if (e.key === "Escape" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      return;
    }
    requestMentions();
  });
  input.addEventListener("keydown", function (e) {
    if (e.isComposing) {
      return;
    }
    const pickerOpen = mentionsEl && !mentionsEl.hidden && mentionItems.length;
    if (pickerOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        hideMentions();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightMention(mentionIndex + 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightMention(mentionIndex - 1);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const item = mentionItems[mentionIndex];
        if (item) {
          applyMention(item.path);
        }
        return;
      }
    }
    if (e.key === "Escape") {
      if (typeof input.blur === "function") {
        input.blur();
      }
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      hideMentions();
      submit();
    }
  });

  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg || !msg.type) {
      return;
    }

    switch (msg.type) {
      case "config":
        if (executionModeEl && msg.executionModeLabel) {
          executionModeEl.textContent = "Mode: " + msg.executionModeLabel;
          executionModeEl.title = msg.executionModeDescription || "";
        }
        renderModeBanner(msg);
        renderPills(msg);
        if (msg.toolOutputFormat === "json" || msg.toolOutputFormat === "readable") {
          toolOutputFormat = msg.toolOutputFormat;
        }
        if (
          msg.toolDisplay === "minimal" ||
          msg.toolDisplay === "compact" ||
          msg.toolDisplay === "balanced" ||
          msg.toolDisplay === "detailed"
        ) {
          toolDisplay = msg.toolDisplay;
          toolCards.forEach(function (card) {
            card.applyDisplay();
          });
        }
        if (msg.chatFormat === "markdown" || msg.chatFormat === "plain") {
          chatFormat = msg.chatFormat;
        }
        break;
      case "session":
        sessionEl.textContent = (msg.sessionId || "").slice(0, 8);
        break;
      case "folder":
        // Single-root workspaces already name the folder in the window
        // title, so only multi-root needs the header indicator.
        folderEl.hidden = !msg.multi;
        if (msg.name && msg.multi) {
          folderEl.textContent = "folder: " + msg.name;
          folderEl.title = msg.path || "";
        } else if (msg.multi) {
          folderEl.textContent = "folder: (pick one)";
          folderEl.title = "";
        } else {
          folderEl.textContent = "";
          folderEl.title = "";
        }
        break;
      case "setup":
        setSetup(msg);
        break;
      case "history":
        renderHistory(msg.items || []);
        break;
      case "expandAll":
        toolCards.forEach(function (card) {
          card.setOpen(true);
        });
        break;
      case "collapseAll":
        toolCards.forEach(function (card) {
          card.setOpen(false);
        });
        break;
      case "cleared":
        clearTranscript();
        break;
      case "user": {
        assistantEl = null;
        const el = addMsg("user", msg.prompt || "");
        appendContextChips(el, msg.attached);
        break;
      }
      case "assistant_delta": {
        const body = ensureAssistant();
        body.textContent += msg.text || "";
        scrollBottom();
        break;
      }
      case "assistant_final": {
        const body = ensureAssistant();
        if (msg.html && chatFormat === "markdown") {
          body.classList.add("md-body");
          body.style.whiteSpace = "normal";
          body.innerHTML = msg.html;
        } else if (msg.text && !body.textContent) {
          body.textContent = msg.text;
        } else if (msg.text) {
          body.textContent = msg.text;
        }
        if (assistantEl) {
          appendFileChips(assistantEl, msg.files);
        }
        if (msg.terminal && msg.terminal !== "completed") {
          addMsg(
            "status",
            "terminal: " + msg.terminal + (msg.reason ? ": " + msg.reason : ""),
          );
        }
        assistantEl = null;
        scrollBottom();
        break;
      }
      case "status":
        addMsg("status", msg.text || "", "status");
        break;
      case "tool":
        addToolCard(msg);
        break;
      case "changes":
        addChangesCard(msg);
        break;
      case "mentionResults":
        if (Number(msg.requestId) === mentionRequestId) {
          renderMentions(msg.items || []);
        }
        break;
      case "currentFileResult":
        if (Number(msg.requestId) === currentFileRequestId && msg.path) {
          addAttachment({ kind: "file", path: msg.path });
        }
        break;
      case "task":
        addMsg("task", msg.text || "", "task");
        break;
      case "stderr":
        addMsg("stderr", truncate(msg.text || "", 4000), "muse", true);
        break;
      case "error":
        addMsg("error", msg.text || "", "error");
        break;
      case "unknown":
        addMsg(
          "unknown",
          truncate(JSON.stringify(msg.payload || {}, null, 2), 1200),
          msg.payloadType || "unknown",
          true,
        );
        break;
      case "running":
        setRunning(!!msg.running);
        if (!msg.running) {
          assistantEl = null;
        }
        break;
    }
  });

  function truncate(s, n) {
    if (s.length <= n) {
      return s;
    }
    return s.slice(0, n) + "…";
  }

  vscode.postMessage({ type: "ready" });
})();
