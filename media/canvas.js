(function () {
  const vscode = acquireVsCodeApi();
  const labelEl = document.getElementById("label");
  const exitEl = document.getElementById("exit");
  const bodyEl = document.getElementById("body");
  const previewFrame = document.getElementById("preview-frame");
  const readableBtn = document.getElementById("readable");
  const rawBtn = document.getElementById("raw");
  const previewBtn = document.getElementById("preview");
  const openExtBtn = document.getElementById("open-ext");
  const copyBtn = document.getElementById("copy");

  // keep in sync with chat.js:LINK_RE
  const LINK_RE =
    /(?:https?:\/\/[^\s<>"']+|file:\/\/[^\s<>"']+|(?:\/[\w./~-]+\.(?:html?|htm|pdf|md|svg|png|jpe?g|gif|webp)))/gi;

  let toolOutputFormat = "readable";
  let userOverride = false;
  let mode = "readable";
  let data = {
    name: "",
    resultRaw: "",
    resultView: null,
    execMeta: null,
    previewHtml: null,
    previewBody: "",
    previewKind: "none",
    openExternallyHref: null,
  };

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
      const href = match[0];
      const a = document.createElement("a");
      a.href = href;
      a.textContent = href;
      a.className = "tool-link";
      a.addEventListener("click", function (e) {
        e.preventDefault();
        vscode.postMessage({ type: "openLink", href: href });
      });
      el.appendChild(a);
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) {
      el.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function activeText() {
    if (mode === "preview") {
      return data.previewBody || data.resultRaw || "";
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
    const hasReadable = !!data.resultView;
    readableBtn.hidden = !hasReadable;
    previewBtn.hidden = !hasPreview();
    openExtBtn.hidden = !data.openExternallyHref;
    readableBtn.classList.toggle("active", mode === "readable");
    rawBtn.classList.toggle("active", mode === "json");
    previewBtn.classList.toggle("active", mode === "preview");
  }

  function renderHeader() {
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
        mode = data.resultView ? "readable" : "json";
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

  function applyData(msg) {
    data = {
      name: msg.name || "",
      resultRaw: msg.resultRaw || "",
      resultView: msg.resultView || null,
      execMeta: msg.execMeta || null,
      previewHtml: msg.previewHtml || null,
      previewBody: msg.previewBody || "",
      previewKind: msg.previewKind || "none",
      openExternallyHref: msg.openExternallyHref || null,
    };
    if (msg.toolOutputFormat === "json" || msg.toolOutputFormat === "readable") {
      toolOutputFormat = msg.toolOutputFormat;
    }
    if (!userOverride) {
      mode = data.resultView ? toolOutputFormat : "json";
    } else if (mode === "readable" && !data.resultView) {
      mode = "json";
    } else if (mode === "preview" && !data.previewHtml) {
      mode = data.resultView ? toolOutputFormat : "json";
    }
    renderHeader();
    renderBody();
  }

  readableBtn.addEventListener("click", function () {
    if (!data.resultView) {
      return;
    }
    userOverride = true;
    mode = "readable";
    renderBody();
  });

  rawBtn.addEventListener("click", function () {
    userOverride = true;
    mode = "json";
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
          if (!userOverride && mode !== "preview") {
            mode = data.resultView ? toolOutputFormat : "json";
            renderBody();
          }
        }
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
