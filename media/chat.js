(function () {
  const vscode = acquireVsCodeApi();
  const transcript = document.getElementById("transcript");
  const latestBtn = document.getElementById("latest");
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
  const renameSessionBtn = document.getElementById("session-rename");
  const forkSessionBtn = document.getElementById("session-fork");
  const sessionActionStatus = document.getElementById("session-action-status");
  const sessionParent = document.getElementById("session-parent");
  let sessionActionBusy = false;
  const modeBanner = document.getElementById("mode-banner");
  const modeBannerText = document.getElementById("mode-banner-text");
  const modeBannerDismiss = document.getElementById("mode-banner-dismiss");
  const focusHint = document.getElementById("focus-hint");
  const modePill = document.getElementById("mode-pill");
  const modelPill = document.getElementById("model-pill");
  const effortPill = document.getElementById("effort-pill");
  const inputMirror = document.getElementById("input-mirror");
  const approvalsEl = document.getElementById("approvals");
  const questionsEl = document.getElementById("questions");
  const draftNote = document.getElementById("draft-note");
  const sessionConflictEl = document.getElementById("session-conflict");
  const sessionConflictText = document.getElementById("session-conflict-text");
  const sessionConflictPanel = document.getElementById("session-conflict-panel");
  const sessionConflictNew = document.getElementById("session-conflict-new");
  let sessionConflict = null;
  let currentSessionId = "";
  const questionCards = new Map();
  input.addEventListener("focus", function () { vscode.postMessage({ type: "activateChat" }); });

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || "");
  const submitChord = isMac ? "⌘Enter" : "Ctrl+Enter";
  input.placeholder = "Ask Muse… (" + submitChord + " to send)";
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
  let submitting = false;
  let museReady = false;
  let assistantEl = null;
  let toolOutputFormat = "readable";
  let toolDisplay = "compact";
  let chatFormat = "markdown";
  const toolCards = new Set();
  const reuseButtons = new Set();
  let draftContextWarning = "";
  let silentToolRuns = 0;
  const MINIMAL_HEARTBEAT_EVERY = 5;
  let mentionItems = [];
  let mentionIndex = 0;
  let mentionRequestId = 0;
  let mentionToken = null;
  // Files picked with @ stay in the prompt text as "@path" (attached at send time).
  let mentionedFiles = [];
  let lastConfig = {};
  let menuEl = null;
  let historyAnchor = null;
  let sessionPicker = null;
  let sessionRequestId = 0;
  let attachments = [];
  let currentFileRequestId = 0;
  let dismissedBannerMode = null;
  let currentExecutionMode = null;
  let copyRequestId = 0;
  const copyButtons = new Map();
  let changesCard = null;
  let turnReviewCards = [];
  let followLatest = true;
  let chatId = (vscode.getState && vscode.getState() || {}).chatId;

  function saveDraft() {
    if (!input.value && !attachments.length) draftContextWarning = "";
    refreshDraftActions();
    if (vscode.setState) {
      vscode.setState({ chatId: chatId, draft: input.value, attachments: attachments, mentionedFiles: mentionedFiles, draftContextWarning: draftContextWarning });
    }
  }

  function restoreDraft() {
    const saved = vscode.getState ? vscode.getState() : null;
    if (!saved || typeof saved.draft !== "string") return;
    input.value = saved.draft;
    if (Array.isArray(saved.attachments)) {
      saved.attachments.slice(0, 16).forEach(addAttachment);
    }
    mentionedFiles = Array.isArray(saved.mentionedFiles)
      ? saved.mentionedFiles.filter(function (path) { return typeof path === "string"; }).slice(0, 16)
      : [];
    draftContextWarning = typeof saved.draftContextWarning === "string" ? saved.draftContextWarning : "";
    syncInputMirror();
    saveDraft();
  }

  // keep in sync with canvas.js:LINK_RE and previewContent.ts:DOC_PATH_SOURCE
  const LINK_RE =
    /(?:(?:https?:\/\/|file:\/\/)[^\s<>"']+|(?<![\w.~/\\-])(?:(?:[A-Za-z]:)?[\\/])?(?:[\w.~-]+[\\/])*[\w.~-]+\.(?:html?|pdf|markdown|md|jsonl?|ya?ml|toon|csv|tsv|txt|xlsx?|svg|png|jpe?g|gif|webp)(?![A-Za-z0-9]))/gi;

  function scrollBottom(force) {
    if (force) followLatest = true;
    if (followLatest) transcript.scrollTop = transcript.scrollHeight;
    if (latestBtn) latestBtn.hidden = followLatest;
  }

  transcript.addEventListener("scroll", function () {
    followLatest = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop < 60;
    if (latestBtn) latestBtn.hidden = followLatest;
  });
  if (latestBtn) latestBtn.addEventListener("click", function () { scrollBottom(true); });

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
    saveDraft();
  }

  function removeAttachment(index) {
    attachments.splice(index, 1);
    renderAttachments();
    saveDraft();
  }

  function clearAttachments() {
    attachments = [];
    renderAttachments();
    saveDraft();
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

  function refreshDraftActions() {
    const occupied = !!input.value || !!attachments.length || submitting || !museReady;
    reuseButtons.forEach(function (button) {
      button.disabled = occupied;
      button.title = occupied ? "Keep or clear your current draft before reusing another message" : "Load this request as a draft. Review and send it as a new turn.";
    });
    if (draftNote) {
      draftNote.textContent = draftContextWarning || (running ? "Muse is working. Prepare your next message here; send it when this turn finishes." : "");
      draftNote.hidden = !draftNote.textContent;
    }
  }

  function addUserMsg(prompt, attached, requestContext) {
    const el = addMsg("user", "");
    const body = el.querySelector(".body");
    if (body) {
      renderPromptInto(body, prompt);
    }
    // Files already shown inline as @path do not need a second chip.
    const inline = mentionedInText(prompt);
    const rest = (attached || []).filter(function (label) {
      return inline.indexOf(String(label)) === -1;
    });
    appendContextChips(el, rest);
    const actions = document.createElement("div");
    actions.className = "message-actions user-actions";
    const reuse = document.createElement("button");
    reuse.type = "button";
    reuse.className = "message-reuse";
    reuse.textContent = "Use as draft";
    reuse.setAttribute("aria-label", "Use this message as a draft");
    reuse.addEventListener("click", function () {
      if (input.value || attachments.length || submitting || !museReady) return;
      input.value = prompt;
      mentionedFiles = [];
      if (Array.isArray(requestContext)) requestContext.slice(0, 16).forEach(function (item) {
        if (item && ["file", "problems", "terminal", "editors"].indexOf(item.kind) !== -1) {
          addAttachment(item);
          if (item.kind === "file" && typeof item.path === "string") mentionedFiles.push(item.path);
        }
      });
      draftContextWarning = !Array.isArray(requestContext) && (attached || []).length
        ? "Reattach context before sending this older message: " + attached.join(", ") : "";
      syncInputMirror(); saveDraft(); input.focus();
    });
    reuseButtons.add(reuse);
    actions.appendChild(reuse);
    el.appendChild(actions);
    refreshDraftActions();
    return el;
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
    if (className === "assistant") {
      el.copyText = text || "";
      const actions = document.createElement("div");
      actions.className = "message-actions";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "message-copy";
      copy.textContent = "Copy response";
      copy.title = "Copy the original response as Markdown";
      copy.addEventListener("click", function () {
        if (!el.copyText || copy.disabled) return;
        copy.disabled = true;
        copyRequestId += 1;
        copyButtons.set(copyRequestId, copy);
        vscode.postMessage({ type: "copyText", text: el.copyText, requestId: copyRequestId });
      });
      actions.appendChild(copy);
      el.appendChild(actions);
    }
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
    const failed = ["failed", "cancelled", "rejected", "timedOut"].includes(data.status) || (
      meta.exitCode !== undefined &&
      meta.exitCode !== null &&
      meta.exitCode !== 0);
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
    if ((meta.exitCode !== undefined && meta.exitCode !== null) || failed) {
      badge = document.createElement("span");
      badge.className =
        "tool-exit " + (failed ? "tool-exit-fail" : "tool-exit-ok");
      const statusText = data.status === "timedOut" ? "timed out" : data.status;
      badge.textContent = meta.exitCode !== undefined && meta.exitCode !== null
        ? (failed && meta.exitCode === 0 ? statusText + " · " : "") + "exit " + meta.exitCode : statusText;
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
    reuseButtons.clear();
    assistantEl = null;
    changesCard = null;
    turnReviewCards = [];
    copyButtons.clear();
    resetSilentToolRuns();
  }

  function renderHistory(items) {
    const previousTop = transcript.scrollTop;
    clearTranscript();
    if (!items || !items.length) {
      return;
    }
    for (const item of items) {
      switch (item.type) {
        case "user":
          addUserMsg(item.text || "", item.attached, item.requestContext);
          break;
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
          if (item.text !== "Run started") {
            addMsg("status", item.text || "", "status");
          }
          break;
        case "error":
          addMsg("error", item.text || "", "error");
          break;
        default:
          break;
      }
    }
    assistantEl = null;
    if (!followLatest) transcript.scrollTop = previousTop;
  }

  function setRunning(value) {
    running = value;
    if (document.body && document.body.classList) {
      document.body.classList.toggle("is-running", !!value);
    }
    sendBtn.disabled = value || submitting || sessionActionBusy || !museReady || !!sessionConflict;
    if (renameSessionBtn) renameSessionBtn.disabled = value || submitting || sessionActionBusy;
    if (forkSessionBtn) forkSessionBtn.disabled = value || submitting || sessionActionBusy;
    if (sessionConflictPanel) sessionConflictPanel.disabled = value || submitting;
    if (sessionConflictNew) sessionConflictNew.disabled = value || submitting;
    stopBtn.disabled = !value;
    input.disabled = submitting || !museReady;
    input.placeholder = value ? "Draft your next message…" : "Ask Muse… (" + submitChord + " to send)";
    refreshDraftActions();
    historyBtn.disabled = value || sessionActionBusy;
    sessionBtn.disabled = value || sessionActionBusy;
    if (toolbarNewBtn) toolbarNewBtn.disabled = false;
    if (toolbarHistoryBtn) toolbarHistoryBtn.disabled = value || submitting || sessionActionBusy;
    turnReviewCards.forEach(function (card) {
      const undo = card.querySelector(".undo-turn");
      if (undo) undo.disabled = value || submitting;
    });
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
    // Short labels so all three fit on one line in a narrow side bar; the
    // tooltip carries the full "Key: value" text.
    if (modePill && msg.executionModeLabel) {
      modePill.textContent = msg.executionModeLabel;
      modePill.title =
        "Mode: " + msg.executionModeLabel +
        (msg.executionModeDescription ? " — " + msg.executionModeDescription : "") +
        " (click to switch)";
    }
    if (modelPill && msg.useEchoProvider) {
      modelPill.textContent = "Echo";
      modelPill.title = "Echo provider (offline test). Click to switch to Meta models.";
    } else if (modelPill && msg.model !== undefined) {
      modelPill.textContent = "Model " + formatModelPill(msg.model);
      modelPill.title = "Model: " + formatModelPill(msg.model) + " (opens settings)";
    }
    if (effortPill && msg.reasoningEffort !== undefined) {
      effortPill.textContent = "Effort " + formatEffortPill(msg.reasoningEffort);
      effortPill.title =
        "Reasoning effort: " + formatEffortPill(msg.reasoningEffort) + " (opens settings)";
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
    if (sessionConflict) { sessionConflictPanel.focus(); return; }
    if ((!prompt && !attachments.length) || running || submitting || sessionActionBusy || !museReady) {
      return;
    }
    hideMentions();
    hideAttachMenu();
    closeMenu();
    assistantEl = null;
    const outgoing = attachments.map(function (a) {
      return a.kind === "file" ? { kind: "file", path: a.path } : { kind: a.kind };
    });
    const inline = inlineMentionedFiles(prompt);
    for (let i = 0; i < inline.length; i++) {
      const already = outgoing.some(function (a) {
        return a.kind === "file" && a.path === inline[i];
      });
      if (!already && outgoing.length < 16) {
        outgoing.push({ kind: "file", path: inline[i] });
      }
    }
    submitting = true;
    setRunning(running);
    vscode.postMessage({
      type: "submit",
      prompt: prompt,
      attachments: outgoing,
    });
  }

  /**
   * Paint @file tokens behind the (transparent-background) textarea. Built
   * with text nodes only, never innerHTML, since the text is user input.
   */
  function syncInputMirror() {
    if (!inputMirror) {
      return;
    }
    inputMirror.textContent = "";
    const text = input.value || "";
    const parts = text.split(/(@[^\s@]+)/);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) {
        continue;
      }
      const isMention =
        part.charAt(0) === "@" &&
        (mentionedFiles.indexOf(part.slice(1)) !== -1 || /[./\\]/.test(part.slice(1)));
      if (isMention) {
        const mark = document.createElement("mark");
        mark.textContent = part;
        inputMirror.appendChild(mark);
      } else {
        inputMirror.appendChild(document.createTextNode(part));
      }
    }
    // A trailing newline in a textarea still takes a line; keep heights equal.
    inputMirror.appendChild(document.createTextNode("​"));
    inputMirror.scrollTop = input.scrollTop;
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** Picked @files whose token is still present in the prompt text. */
  function inlineMentionedFiles(text) {
    return mentionedFiles.filter(function (path) {
      return new RegExp("(^|\\s)@" + escapeRegExp(path) + "(?=\\s|$)").test(text);
    });
  }

  /** User prompt with @file tokens rendered as inline pills. */
  function renderPromptInto(body, text) {
    body.textContent = "";
    const parts = String(text || "").split(/(@[^\s@]+)/);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) {
        continue;
      }
      if (part.charAt(0) === "@" && part.length > 1) {
        const tok = document.createElement("span");
        tok.className = "mention-token";
        tok.textContent = part;
        body.appendChild(tok);
      } else if (typeof document.createTextNode === "function") {
        body.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement("span");
        span.textContent = part;
        body.appendChild(span);
      }
    }
  }

  function mentionedInText(text) {
    const out = [];
    const re = /(^|\s)@([^\s@]+)/g;
    let m;
    while ((m = re.exec(String(text || ""))) !== null) {
      out.push(m[2]);
    }
    return out;
  }

  // ---------- dropdown menus (mode / model / effort / sessions) ----------

  function closeMenu() {
    if (menuEl && menuEl.parentNode && typeof menuEl.parentNode.removeChild === "function") {
      menuEl.parentNode.removeChild(menuEl);
    }
    menuEl = null;
    sessionPicker = null;
  }

  function placeMenu(el, anchor) {
    if (!anchor || typeof anchor.getBoundingClientRect !== "function" || !el.style) {
      return;
    }
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const width = Math.min(300, Math.max(180, vw - 16));
    el.style.width = width + "px";
    const left = Math.min(Math.max(8, r.left), Math.max(8, vw - width - 8));
    el.style.left = left + "px";
    if (r.top > vh / 2) {
      el.style.bottom = Math.max(8, vh - r.top + 4) + "px";
      el.style.maxHeight = Math.max(120, r.top - 16) + "px";
    } else {
      el.style.top = r.bottom + 4 + "px";
      el.style.maxHeight = Math.max(120, vh - r.bottom - 16) + "px";
    }
  }

  /**
   * items: [{ label, detail, value, checked } | { separator: true } | { empty: true, label }]
   * onPick(value) runs with the chosen item's value.
   */
  function openMenu(anchor, title, items, onPick) {
    const wasSame = menuEl && menuEl.__anchor === anchor;
    closeMenu();
    if (wasSame) {
      return;
    }
    const el = document.createElement("div");
    el.className = "menu";
    if (typeof el.setAttribute === "function") {
      el.setAttribute("role", "menu");
    }
    el.__anchor = anchor;
    if (title) {
      const head = document.createElement("div");
      head.className = "menu-title";
      head.textContent = title;
      el.appendChild(head);
    }
    for (let i = 0; i < items.length; i++) {
      (function (item) {
        if (item.separator) {
          const sep = document.createElement("div");
          sep.className = "menu-sep";
          el.appendChild(sep);
          return;
        }
        if (item.empty) {
          const empty = document.createElement("div");
          empty.className = "menu-empty";
          empty.textContent = item.label;
          el.appendChild(empty);
          return;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "menu-item" + (item.checked ? " checked" : "");
        if (typeof btn.setAttribute === "function") {
          btn.setAttribute("role", "menuitemradio");
          btn.setAttribute("aria-checked", item.checked ? "true" : "false");
        }
        const check = document.createElement("span");
        check.className = "menu-check";
        check.textContent = item.checked ? "✓" : "";
        const text = document.createElement("span");
        text.className = "menu-text";
        const label = document.createElement("span");
        label.className = "menu-label";
        label.textContent = item.label;
        text.appendChild(label);
        if (item.detail) {
          const detail = document.createElement("span");
          detail.className = "menu-detail";
          detail.textContent = item.detail;
          text.appendChild(detail);
        }
        btn.appendChild(check);
        btn.appendChild(text);
        btn.addEventListener("click", function () {
          closeMenu();
          onPick(item.value);
        });
        el.appendChild(btn);
      })(items[i]);
    }
    const host = document.body || transcript.parentNode || transcript;
    host.appendChild(el);
    placeMenu(el, anchor);
    menuEl = el;
  }

  function relativeTime(ms) {
    if (!ms) {
      return "";
    }
    const min = Math.round(Math.max(0, Date.now() - ms) / 60000);
    if (min < 1) {
      return "just now";
    }
    if (min < 60) {
      return min + "m ago";
    }
    const h = Math.round(min / 60);
    if (h < 24) {
      return h + "h ago";
    }
    return Math.round(h / 24) + "d ago";
  }

  function openModeMenu() {
    const current = lastConfig.executionMode || "headless";
    openMenu(
      modePill,
      "Mode",
      [
        {
          label: "Panel approvals",
          detail: "Review tool permissions here in chat",
          value: "panel",
          checked: current === "panel",
        },
        {
          label: "Windows compatibility",
          detail: "Sandboxed Windows shell; Headless permissions",
          value: "windows",
          checked: current === "windows",
        },
        {
          label: "Headless",
          detail: "Chat here; approvals are skipped",
          value: "headless",
          checked: current === "headless",
        },
        {
          label: "Interactive",
          detail: "Muse terminal; can ask for approvals",
          value: "interactive",
          checked: current === "interactive",
        },
      ],
      function (value) {
        vscode.postMessage({ type: "setSetting", key: "executionMode", value: value });
      },
    );
  }

  function openModelMenu() {
    const echoOn = !!lastConfig.useEchoProvider;
    const current = lastConfig.model || "";
    const options = lastConfig.modelOptions || [{ value: "", label: "Auto" }];
    const items = echoOn
      ? [
          { label: "Echo (offline test)", detail: "Replies repeat your prompt; no Meta API", value: "__echo_on__", checked: true },
          { separator: true },
          { label: "Use Meta models", detail: "Turn off echo and pick a model", value: "__echo_off__" },
        ]
      : options
          .map(function (o) {
            return { label: o.label, detail: o.detail, value: o.value, checked: o.value === current };
          })
          .concat([
            { separator: true },
            { label: "Echo (offline test)", detail: "No API calls; replies repeat your prompt", value: "__echo_on__" },
          ]);
    openMenu(modelPill, "Model", items, function (value) {
      if (value === "__echo_on__" || value === "__echo_off__") {
        if ((value === "__echo_on__") !== echoOn) {
          vscode.postMessage({ type: "setSetting", key: "useEchoProvider", value: value === "__echo_on__" ? "true" : "false" });
        }
        return;
      }
      vscode.postMessage({ type: "setSetting", key: "model", value: value });
    });
  }

  function openEffortMenu() {
    const current = lastConfig.reasoningEffort || "";
    const options = lastConfig.effortOptions || [{ value: "", label: "Default" }];
    openMenu(
      effortPill,
      "Reasoning effort",
      options.map(function (o) {
        return { label: o.label, detail: o.detail, value: o.value, checked: o.value === current };
      }),
      function (value) {
        vscode.postMessage({ type: "setSetting", key: "reasoningEffort", value: value });
      },
    );
  }

  function requestSessionSearch(query) {
    if (!sessionPicker) return;
    sessionRequestId += 1;
    sessionPicker.results.textContent = "";
    sessionPicker.buttons = [];
    sessionPicker.status.textContent = "Searching…";
    sessionPicker.search.removeAttribute("aria-activedescendant");
    vscode.postMessage({ type: "listSessions", query: query.slice(0, 256), requestId: sessionRequestId });
  }

  function highlightSession(index) {
    const picker = sessionPicker;
    if (!picker || !picker.buttons.length) return;
    picker.index = (index + picker.buttons.length) % picker.buttons.length;
    picker.buttons.forEach(function (button, i) {
      button.classList.toggle("active", i === picker.index);
      button.setAttribute("aria-selected", i === picker.index ? "true" : "false");
    });
    const active = picker.buttons[picker.index];
    picker.search.setAttribute("aria-activedescendant", active.id);
    if (typeof active.scrollIntoView === "function") active.scrollIntoView({ block: "nearest" });
  }

  function renderSessionMenu(msg) {
    const picker = sessionPicker;
    if (!picker || msg.requestId !== sessionRequestId) return;
    picker.results.textContent = "";
    picker.buttons = [];
    const list = msg.items || [];
    picker.status.textContent = msg.error || (!list.length
      ? (picker.search.value.trim() ? "No matching sessions. Try another word or session id." : "No earlier sessions in this folder.")
      : list.length >= msg.limit ? "Showing the latest " + list.length + " matches. Narrow your search for older sessions." : list.length + (list.length === 1 ? " session" : " sessions"));
    list.forEach(function (s, i) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item session-result";
      button.id = "session-result-" + sessionRequestId + "-" + i;
      button.setAttribute("role", "option");
      const text = document.createElement("span");
      text.className = "menu-text";
      const title = document.createElement("span");
      title.className = "menu-label";
      title.textContent = (s.current ? "Current · " : "") + s.title;
      text.appendChild(title);
      const detail = document.createElement("span");
      detail.className = "menu-detail";
      detail.textContent = [relativeTime(s.updatedMs), s.turns ? s.turns + (s.turns === 1 ? " turn" : " turns") : "", String(s.id).slice(0, 8)].filter(Boolean).join(" · ");
      text.appendChild(detail);
      if (s.preview && s.preview !== s.title) {
        const preview = document.createElement("span");
        preview.className = "menu-detail session-preview";
        preview.textContent = s.preview;
        text.appendChild(preview);
      }
      button.appendChild(text);
      button.title = s.title + "\n" + (s.preview || "") + "\n" + s.id;
      button.addEventListener("click", function () {
        closeMenu();
        vscode.postMessage({ type: "resumeSession", sessionId: s.id });
      });
      picker.buttons.push(button);
      picker.results.appendChild(button);
    });
    highlightSession(0);
  }

  function openSessionMenu(anchor) {
    closeMenu();
    const el = document.createElement("div");
    el.className = "menu session-menu";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Session history");
    el.__anchor = anchor;
    const search = document.createElement("input");
    search.className = "session-search";
    search.type = "search";
    search.placeholder = "Search title, first message or session id…";
    search.maxLength = 256;
    search.setAttribute("role", "combobox");
    search.setAttribute("aria-label", "Search sessions");
    search.setAttribute("aria-autocomplete", "list");
    search.setAttribute("aria-expanded", "true");
    search.setAttribute("aria-controls", "session-results");
    el.appendChild(search);
    const status = document.createElement("div");
    status.className = "menu-empty session-status";
    status.setAttribute("role", "status");
    el.appendChild(status);
    const results = document.createElement("div");
    results.className = "session-results";
    results.id = "session-results";
    results.setAttribute("role", "listbox");
    results.setAttribute("aria-label", "Matching sessions");
    el.appendChild(results);
    [["New session", "newSession"], ["Clean up sessions…", "cleanupSessions"]].forEach(function (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item session-action";
      button.textContent = action[0];
      button.addEventListener("click", function () { closeMenu(); vscode.postMessage({ type: action[1] }); });
      el.appendChild(button);
    });
    (document.body || transcript.parentNode || transcript).appendChild(el);
    placeMenu(el, anchor);
    menuEl = el;
    sessionPicker = { search: search, status: status, results: results, buttons: [], index: 0 };
    search.addEventListener("input", function () { requestSessionSearch(search.value); });
    search.addEventListener("keydown", function (event) {
      if (event.isComposing || !sessionPicker) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        highlightSession(sessionPicker.index + (event.key === "ArrowDown" ? 1 : -1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const button = sessionPicker.buttons[sessionPicker.index];
        if (button) button.click();
      }
    });
    el.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        if (anchor && typeof anchor.focus === "function") anchor.focus();
      }
    });
    search.focus();
    requestSessionSearch("");
  }

  function pickSession(event) {
    if (running || submitting) {
      return;
    }
    const anchor = event && event.currentTarget ? event.currentTarget : toolbarHistoryBtn;
    if (menuEl && menuEl.__anchor === anchor) {
      closeMenu();
      return;
    }
    historyAnchor = anchor;
    openSessionMenu(anchor);
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
    // The pick stays inline as "@path " in the prompt; its contents are
    // attached at send time while the token is still in the text.
    const insert = "@" + path + " ";
    input.value = input.value.slice(0, token.start) + insert + input.value.slice(token.end);
    const nextCursor = token.start + insert.length;
    input.selectionStart = nextCursor;
    input.selectionEnd = nextCursor;
    if (mentionedFiles.indexOf(path) === -1) {
      mentionedFiles.push(path);
    }
    syncInputMirror();
    hideMentions();
    saveDraft();
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
    if (!msg.turnId && changesCard && changesCard.parentNode) changesCard.parentNode.removeChild(changesCard);
    const files = msg.files || [];
    const el = addMsg(
      "changes",
      (msg.prompt ? msg.prompt + "\n" : "") + files.length + (files.length === 1 ? " file changed." : " files changed.") + (msg.turnId ? (msg.undone ? " Turn undone." : " Saved before/after snapshots.") : " Changes are already on disk."),
      msg.turnId ? "Turn · " + new Date(msg.createdAt).toLocaleString() : "Changed files",
    );
    if (msg.turnId) turnReviewCards.push(el); else changesCard = el;
    for (const file of files) {
      const fileBtn = document.createElement("button");
      fileBtn.type = "button";
      fileBtn.className = "changed-file";
      fileBtn.textContent = file.path + " · " + (file.status === "??" ? "new" : file.status);
      fileBtn.title = msg.turnId ? "Open saved before/after diff for this turn" : file.status === "??" ? "Open new file" : "Open VS Code Git diff (may include earlier edits)";
      fileBtn.addEventListener("click", function () {
        vscode.postMessage(msg.turnId ? { type: "openTurnDiff", turnId: msg.turnId, path: file.path } : { type: "openChangedFile", path: file.path });
      });
      el.appendChild(fileBtn);
    }
    const actions = document.createElement("div");
    actions.className = "changes-actions";
    if (msg.turnId) {
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "secondary undo-turn";
      undo.textContent = msg.undone ? "Redo this turn" : "Undo this turn";
      undo.title = msg.undone ? "Reapply this turn's saved changes. Blocked if a file changed after undo or has an unsaved editor." : "Restore the pre-turn file contents. Blocked if a file has newer edits or an unsaved editor.";
      undo.turnUndone = !!msg.undone;
      undo.disabled = running || submitting;
      undo.addEventListener("click", function () {
        if (undo.disabled) return;
        undo.disabled = true;
        vscode.postMessage({ type: msg.undone ? "redoTurn" : "undoTurn", turnId: msg.turnId });
      });
      actions.appendChild(undo);
      el.appendChild(actions);
      return;
    }
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
  function resolveSessionConflict(action) {
    if (!sessionConflict || running || submitting) return;
    vscode.postMessage({ type: "resolveSessionMode", sessionId: sessionConflict.sessionId, mode: sessionConflict.mode, action: action });
  }
  if (sessionConflictPanel) sessionConflictPanel.addEventListener("click", function () { resolveSessionConflict("panel"); });
  if (sessionConflictNew) sessionConflictNew.addEventListener("click", function () { resolveSessionConflict("newSession"); });
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
      vscode.postMessage({ type: "newSession" });
    });
  }
  if (renameSessionBtn) renameSessionBtn.addEventListener("click", function () {
    if (!running && !submitting && !sessionActionBusy) vscode.postMessage({ type: "renameSession" });
  });
  if (forkSessionBtn) forkSessionBtn.addEventListener("click", function () {
    if (!running && !submitting && !sessionActionBusy) vscode.postMessage({ type: "forkSession" });
  });
  if (modeBannerDismiss) {
    modeBannerDismiss.addEventListener("click", function () {
      dismissedBannerMode = currentExecutionMode;
      if (modeBanner) {
        modeBanner.hidden = true;
      }
    });
  }
  input.addEventListener("input", function () { syncInputMirror(); saveDraft(); });
  input.addEventListener("scroll", function () {
    if (inputMirror) {
      inputMirror.scrollTop = input.scrollTop;
    }
  });
  if (modePill) {
    modePill.addEventListener("click", openModeMenu);
  }
  if (modelPill) {
    modelPill.addEventListener("click", openModelMenu);
  }
  if (effortPill) {
    effortPill.addEventListener("click", openEffortMenu);
  }
  if (typeof document.addEventListener === "function") {
    document.addEventListener("mousedown", function (e) {
      if (!menuEl) {
        return;
      }
      let node = e.target;
      while (node) {
        if (node === menuEl || node === menuEl.__anchor) {
          return;
        }
        node = node.parentNode;
      }
      closeMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menuEl) {
        closeMenu();
      }
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

  function renderQuestions(items) {
    if (!questionsEl) return;
    const ids = new Set(items.map(function (request) { return request.userInputId; }));
    questionCards.forEach(function (card, id) {
      if (!ids.has(id)) { card.el.parentNode.removeChild(card.el); questionCards.delete(id); }
    });
    questionsEl.hidden = !items.length;
    items.forEach(function (request) {
      let card = questionCards.get(request.userInputId);
      if (!card) {
        const section = document.createElement("section");
        section.className = "question-request";
        const title = document.createElement("h3");
        title.textContent = "Muse needs your input";
        section.appendChild(title);
        const controls = [];
        const entries = request.questions.map(function (question) {
          const field = document.createElement("fieldset");
          const legend = document.createElement("legend");
          legend.textContent = question.header;
          field.appendChild(legend);
          const prompt = document.createElement("p");
          prompt.textContent = question.question;
          field.appendChild(prompt);
          const multiple = question.selection.mode === "multiple";
          const options = question.options.map(function (option) {
            const label = document.createElement("label");
            label.className = "question-option";
            const choice = document.createElement("input");
            choice.type = multiple ? "checkbox" : "radio";
            choice.name = request.userInputId + "-" + question.id;
            choice.value = option.label;
            const text = document.createElement("span");
            text.textContent = option.label + (option.description ? " — " + option.description : "");
            label.appendChild(choice); label.appendChild(text); field.appendChild(label);
            controls.push(choice);
            return choice;
          });
          const written = document.createElement("textarea");
          written.className = "question-written";
          written.maxLength = 500;
          written.placeholder = "Or write your own answer…";
          written.setAttribute("aria-label", question.header + ": written answer");
          controls.push(written); field.appendChild(written); section.appendChild(field);
          return { question: question, options: options, written: written };
        });
        const error = document.createElement("p");
        error.className = "question-error";
        error.setAttribute("role", "status");
        section.appendChild(error);
        const send = document.createElement("button");
        send.type = "button"; send.className = "question-send"; send.textContent = "Send answers";
        send.addEventListener("click", function () {
          if (card.busy) return;
          const answers = [];
          let problem = "";
          entries.forEach(function (entry) {
            const question = entry.question;
            const text = entry.written.value.trim();
            const selected = entry.options.filter(function (option) { return option.checked; }).map(function (option) { return option.value; });
            if (text) { answers.push({ questionId: question.id, freeText: text }); return; }
            if (question.selection.mode === "single" && selected.length === 1) {
              answers.push({ questionId: question.id, selectedLabel: selected[0] }); return;
            }
            const min = question.selection.minSelections === undefined ? 1 : question.selection.minSelections;
            const max = question.selection.maxSelections === undefined ? entry.options.length : question.selection.maxSelections;
            if (question.selection.mode === "multiple" && selected.length >= min && selected.length <= max) {
              answers.push({ questionId: question.id, selectedLabels: selected }); return;
            }
            problem = "Answer every question. " + (question.selection.mode === "multiple" ? "Choose " + min + "–" + max + " options or write an answer." : "Choose an option or write an answer.");
          });
          if (problem) { error.textContent = problem; return; }
          card.busy = true; controls.forEach(function (control) { control.disabled = true; }); send.disabled = true;
          vscode.postMessage({ type: "questionAnswer", userInputId: request.userInputId, answers: answers });
        });
        section.appendChild(send);
        card = { el: section, controls: controls, send: send, error: error, busy: false };
        questionCards.set(request.userInputId, card); questionsEl.appendChild(section);
      }
      card.busy = !!request.submitting;
      card.controls.forEach(function (control) { control.disabled = card.busy; });
      card.send.disabled = card.busy;
      card.send.textContent = card.busy ? "Sending answers…" : "Send answers";
      card.error.textContent = request.error || "";
    });
  }

  function renderApprovals(items) {
    if (!approvalsEl) return;
    approvalsEl.textContent = "";
    approvalsEl.hidden = !items.length;
    items.forEach(function (request) {
      const section = document.createElement("section");
      section.className = "approval-request";
      const title = document.createElement("h3");
      title.textContent = "Permission needed · " + request.toolName;
      section.appendChild(title);
      const detail = document.createElement("pre");
      const subject = request.subject || {};
      const target = subject.command || subject.path || subject.target || subject.kind;
      detail.textContent = target + (request.rawArgs ? "\n\n" + request.rawArgs : "");
      section.appendChild(detail);
      if (request.reviewerReason) {
        const reason = document.createElement("p");
        reason.textContent = request.reviewerReason;
        section.appendChild(reason);
      }
      let feedback = null;
      if (request.availableChoices.some(function (choice) { return choice.acceptsFeedback; })) {
        feedback = document.createElement("textarea");
        feedback.className = "approval-feedback";
        feedback.setAttribute("aria-label", "Optional guidance for Muse");
        feedback.placeholder = "Optional guidance for Muse";
        section.appendChild(feedback);
      }
      const actions = document.createElement("div");
      let deciding = false;
      const buttons = [];
      actions.className = "approval-actions";
      request.availableChoices.forEach(function (choice) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = choice.label;
        button.title = choice.rulePreview || ("Scope: " + choice.scope);
        button.addEventListener("click", function () {
          if (deciding) return;
          deciding = true;
          buttons.forEach(function (b) { b.disabled = true; });
          vscode.postMessage({ type: "approvalDecision", approvalId: request.approvalId,
            sourceIndex: request.currentRequirementId.sourceIndex, choiceId: choice.choiceId,
            feedback: choice.acceptsFeedback && feedback ? feedback.value : undefined });
        });
        actions.appendChild(button);
        buttons.push(button);
        if (choice.rulePreview || choice.scope !== "once") {
          const scope = document.createElement("p");
          scope.className = "approval-scope";
          scope.textContent = choice.rulePreview || ("Scope: " + choice.scope);
          actions.appendChild(scope);
        }
      });
      section.appendChild(actions);
      approvalsEl.appendChild(section);
    });
  }

  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg || !msg.type) {
      return;
    }

    switch (msg.type) {
      case "chatIdentity":
        chatId = msg.chatId;
        saveDraft();
        break;
      case "config":
        if (sessionConflict && sessionConflict.mode !== msg.executionMode) {
          sessionConflict = null;
          if (sessionConflictEl) sessionConflictEl.hidden = true;
          setRunning(running);
        }
        lastConfig = msg;
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
      case "approvals":
        renderApprovals(Array.isArray(msg.items) ? msg.items : []);
        break;
      case "questions":
        renderQuestions(Array.isArray(msg.items) ? msg.items : []);
        break;
      case "sessionCompatibility":
        if (msg.sessionId !== currentSessionId || (lastConfig.executionMode && msg.mode !== lastConfig.executionMode)) break;
        sessionConflict = msg.conflict || null;
        if (sessionConflictEl) sessionConflictEl.hidden = !sessionConflict;
        if (sessionConflictText) sessionConflictText.textContent = sessionConflict ? sessionConflict.text : "";
        setRunning(running);
        break;
      case "session":
        if (currentSessionId !== msg.sessionId) {
          sessionConflict = null;
          if (sessionConflictEl) sessionConflictEl.hidden = true;
          setRunning(running);
        }
        currentSessionId = msg.sessionId || "";
        sessionEl.textContent = msg.title || "New chat";
        sessionEl.title = (msg.title ? msg.title + " · " : "") + "Session " + (msg.sessionId || "");
        if (msg.parentSessionId) sessionEl.title += " · Branched from " + msg.parentSessionId;
        if (sessionParent) {
          sessionParent.hidden = !msg.parentSessionId;
          sessionParent.textContent = msg.parentSessionId ? "Branch of " + msg.parentSessionId.slice(0, 8) : "";
          sessionParent.title = msg.parentSessionId || "";
        }
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
      case "submitAccepted":
        if (submitting) {
          input.value = "";
          mentionedFiles = [];
          syncInputMirror();
          clearAttachments();
        }
        break;
      case "submitFinished":
        submitting = false;
        setRunning(running);
        break;
      case "history":
        renderHistory(msg.items || []);
        break;
      case "sessionList":
        renderSessionMenu(msg);
        break;
      case "sessionAction":
        sessionActionBusy = !!msg.busy;
        if (sessionActionStatus) {
          sessionActionStatus.hidden = !sessionActionBusy;
          sessionActionStatus.textContent = sessionActionBusy ? (msg.action === "fork" ? "Creating branch from completed turns… Workspace files stay as they are." : "Saving conversation name…") : "";
        }
        setRunning(running);
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
        addUserMsg(msg.prompt || "", msg.attached, msg.requestContext);
        scrollBottom(true);
        break;
      }
      case "assistant_delta": {
        const body = ensureAssistant();
        body.textContent += msg.text || "";
        assistantEl.copyText += msg.text || "";
        scrollBottom();
        break;
      }
      case "assistant_begin":
        assistantEl = null;
        break;
      case "assistant_final": {
        const body = ensureAssistant();
        assistantEl.copyText = msg.text || assistantEl.copyText;
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
        // "Run started" duplicates the working indicator.
        if (msg.text !== "Run started") {
          addMsg("status", msg.text || "", "status");
        }
        break;
      case "tool":
        addToolCard(msg);
        break;
      case "changes":
        addChangesCard(msg);
        break;
      case "turnReviews":
        turnReviewCards.forEach(function (card) { if (card.parentNode) card.parentNode.removeChild(card); });
        turnReviewCards = [];
        (msg.turns || []).forEach(addChangesCard);
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
      case "copyResult": {
        const button = copyButtons.get(msg.requestId);
        if (button) {
          button.disabled = false;
          button.textContent = msg.ok ? "Copied" : "Copy failed · retry";
          copyButtons.delete(msg.requestId);
        }
        break;
      }
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

  restoreDraft();
  vscode.postMessage({ type: "ready" });
})();
