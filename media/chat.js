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
  const setupEl = document.getElementById("setup");
  const setupMsg = document.getElementById("setup-msg");
  const setupInstall = document.getElementById("setup-install");
  const recheckBtn = document.getElementById("recheck");
  const docsBtn = document.getElementById("docs");
  const pickFolderBtn = document.getElementById("pick-folder");

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

  function addMsg(className, text, label, linkify, html, files) {
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
    if (toolDisplay === "detailed") {
      return true;
    }
    if (toolDisplay === "compact") {
      return false;
    }
    return (
      text.length <= PREVIEW_CHARS && text.split("\n").length <= PREVIEW_LINES
    );
  }

  function addToolCard(data) {
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
    const meta = data.execMeta || {};
    label.textContent = toolSummary(data);
    disclosureBtn.appendChild(label);
    header.appendChild(disclosureBtn);

    if (meta.exitCode !== undefined && meta.exitCode !== null) {
      const badge = document.createElement("span");
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
        if (manualDisclosure) {
          return;
        }
        cardOpen = shouldOpenToolCard(activeText());
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
      scrollBottom();
    });
    disclosureBtn.addEventListener("click", function () {
      manualDisclosure = true;
      cardOpen = !cardOpen;
      renderDisclosure();
      scrollBottom();
    });

    header.appendChild(expandBtn);
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
  }

  function renderHistory(items) {
    clearTranscript();
    if (!items || !items.length) {
      return;
    }
    for (const item of items) {
      switch (item.type) {
        case "user":
          addMsg("user", item.text || "");
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

  function ensureAssistant() {
    if (!assistantEl) {
      assistantEl = addMsg("assistant", "", "Muse");
    }
    return assistantEl.querySelector(".body");
  }

  function submit() {
    const prompt = input.value.trim();
    if (!prompt || running || !museReady) {
      return;
    }
    assistantEl = null;
    vscode.postMessage({ type: "submit", prompt });
    input.value = "";
  }

  function pickSession() {
    if (running) {
      return;
    }
    vscode.postMessage({ type: "pickSession" });
  }

  sendBtn.addEventListener("click", submit);
  stopBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "stop" });
  });
  historyBtn.addEventListener("click", pickSession);
  sessionBtn.addEventListener("click", pickSession);
  recheckBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "recheck" });
  });
  docsBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "openDocs" });
  });
  pickFolderBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "selectFolder" });
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
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
        if (msg.toolOutputFormat === "json" || msg.toolOutputFormat === "readable") {
          toolOutputFormat = msg.toolOutputFormat;
        }
        if (msg.chatFormat === "markdown" || msg.chatFormat === "plain") {
          chatFormat = msg.chatFormat;
        }
        break;
      case "session":
        sessionEl.textContent = (msg.sessionId || "").slice(0, 8);
        break;
      case "folder":
        if (msg.name) {
          folderEl.textContent = msg.multi ? "folder: " + msg.name : msg.name;
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
      case "cleared":
        clearTranscript();
        break;
      case "user":
        assistantEl = null;
        addMsg("user", msg.prompt || "");
        break;
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
