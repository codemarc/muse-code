(function () {
  const vscode = acquireVsCodeApi();
  const labelEl = document.getElementById("label");
  const exitEl = document.getElementById("exit");
  const bodyEl = document.getElementById("body");
  const previewFrame = document.getElementById("preview-frame");
  const readableBtn = document.getElementById("readable");
  const rawBtn = document.getElementById("raw");
  const sourceBtn = document.getElementById("source");
  const previewBtn = document.getElementById("preview");
  const openExtBtn = document.getElementById("open-ext");
  const copyBtn = document.getElementById("copy");

  // keep in sync with chat.js:LINK_RE and previewContent.ts:DOC_PATH_SOURCE
  const LINK_RE =
    /(?:(?:https?:\/\/|file:\/\/)[^\s<>"']+|(?<![\w.~/-])\/?(?:[\w.~-]+\/)*[\w.~-]+\.(?:html?|pdf|markdown|md|jsonl?|ya?ml|toon|csv|tsv|txt|xlsx?|svg|png|jpe?g|gif|webp)(?![A-Za-z0-9]))/gi;

  let toolOutputFormat = "readable";
  let userOverride = false;
  let mode = "readable";
  let data = {
    source: "stdout",
    name: "",
    resultRaw: "",
    resultView: null,
    execMeta: null,
    previewHtml: null,
    previewBody: "",
    previewKind: "none",
    openExternallyHref: null,
    filePath: null,
  };

  function isFileMode() {
    return data.source === "file";
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

  function activeText() {
    if (mode === "preview") {
      return data.previewBody || data.resultRaw || "";
    }
    if (isFileMode() || mode === "source" || mode === "json") {
      return data.resultRaw || data.previewBody || "";
    }
    if (mode === "readable" && data.resultView) {
      return data.resultView;
    }
    return data.resultRaw || "";
  }

  function hasPreview() {
    return !!data.previewHtml;
  }

  function syncToggleState() {
    const file = isFileMode();
    const hasReadable = !!data.resultView && !file;
    readableBtn.hidden = !hasReadable;
    rawBtn.hidden = file;
    sourceBtn.hidden = !file;
    previewBtn.hidden = !hasPreview();
    openExtBtn.hidden = !data.openExternallyHref;
    readableBtn.classList.toggle("active", mode === "readable");
    rawBtn.classList.toggle("active", mode === "json");
    sourceBtn.classList.toggle("active", mode === "source" || (file && mode === "json"));
    previewBtn.classList.toggle("active", mode === "preview");
  }

  function renderHeader() {
    if (isFileMode()) {
      labelEl.textContent = data.name || data.filePath || "File";
      exitEl.hidden = true;
      exitEl.textContent = "";
      exitEl.className = "tool-exit";
      return;
    }
    const meta = data.execMeta || {};
    labelEl.textContent =
      meta.description ||
      (meta.command ? "$ " + meta.command : "") ||
      (data.name ? "tool: " + data.name : "Tool result");

    if (meta.exitCode !== undefined && meta.exitCode !== null) {
      exitEl.hidden = false;
      exitEl.textContent = "exit " + meta.exitCode;
      exitEl.className =
        "tool-exit " + (meta.exitCode === 0 ? "tool-exit-ok" : "tool-exit-fail");
    } else {
      exitEl.hidden = true;
      exitEl.textContent = "";
      exitEl.className = "tool-exit";
    }
  }

  function renderBody() {
    syncToggleState();
    if (mode === "preview" && data.previewHtml) {
      bodyEl.hidden = true;
      previewFrame.hidden = false;
      try {
        previewFrame.srcdoc = data.previewHtml;
      } catch (err) {
        bodyEl.hidden = false;
        previewFrame.hidden = true;
        previewFrame.removeAttribute("srcdoc");
        mode = isFileMode() ? "source" : data.resultView ? "readable" : "json";
        linkifyInto(bodyEl, activeText());
        syncToggleState();
        vscode.postMessage({ type: "previewFailed" });
      }
      return;
    }

    previewFrame.hidden = true;
    previewFrame.removeAttribute("srcdoc");
    bodyEl.hidden = false;
    linkifyInto(bodyEl, activeText());
  }

  function defaultMode() {
    if (isFileMode()) {
      return hasPreview() ? "preview" : "source";
    }
    if (hasPreview() && !data.resultView) {
      return "preview";
    }
    return data.resultView ? toolOutputFormat : "json";
  }

  function applyData(msg) {
    data = {
      source: msg.source === "file" ? "file" : "stdout",
      name: msg.name || "",
      resultRaw: msg.resultRaw || "",
      resultView: msg.resultView || null,
      execMeta: msg.execMeta || null,
      previewHtml: msg.previewHtml || null,
      previewBody: msg.previewBody || "",
      previewKind: msg.previewKind || "none",
      openExternallyHref: msg.openExternallyHref || null,
      filePath: msg.filePath || null,
    };
    if (msg.toolOutputFormat === "json" || msg.toolOutputFormat === "readable") {
      toolOutputFormat = msg.toolOutputFormat;
    }
    if (!userOverride) {
      mode = defaultMode();
    } else if (mode === "readable" && !data.resultView) {
      mode = isFileMode() ? "source" : "json";
    } else if (mode === "preview" && !data.previewHtml) {
      mode = defaultMode();
    }
    renderHeader();
    renderBody();
  }

  readableBtn.addEventListener("click", function () {
    if (!data.resultView || isFileMode()) {
      return;
    }
    userOverride = true;
    mode = "readable";
    renderBody();
  });

  rawBtn.addEventListener("click", function () {
    if (isFileMode()) {
      return;
    }
    userOverride = true;
    mode = "json";
    renderBody();
  });

  sourceBtn.addEventListener("click", function () {
    userOverride = true;
    mode = "source";
    renderBody();
  });

  previewBtn.addEventListener("click", function () {
    if (!data.previewHtml) {
      return;
    }
    userOverride = true;
    mode = "preview";
    renderBody();
  });

  openExtBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "openExternally" });
  });

  copyBtn.addEventListener("click", function () {
    const text = activeText();
    if (!text) {
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {
        vscode.postMessage({ type: "copyFailed" });
      });
      return;
    }
    vscode.postMessage({ type: "copyText", text: text });
  });

  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg || !msg.type) {
      return;
    }
    switch (msg.type) {
      case "canvasData":
        userOverride = false;
        applyData(msg);
        break;
      case "config":
        if (msg.toolOutputFormat === "json" || msg.toolOutputFormat === "readable") {
          toolOutputFormat = msg.toolOutputFormat;
          if (!userOverride && mode !== "preview" && !isFileMode()) {
            mode = data.resultView ? toolOutputFormat : "json";
            renderBody();
          }
        }
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
