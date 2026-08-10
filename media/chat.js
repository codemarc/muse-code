(function () {
  const vscode = acquireVsCodeApi();
  const transcript = document.getElementById("transcript");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const stopBtn = document.getElementById("stop");
  const sessionEl = document.getElementById("session");
  const folderEl = document.getElementById("folder");
  const setupEl = document.getElementById("setup");
  const setupMsg = document.getElementById("setup-msg");
  const setupInstall = document.getElementById("setup-install");
  const recheckBtn = document.getElementById("recheck");
  const docsBtn = document.getElementById("docs");
  const pickFolderBtn = document.getElementById("pick-folder");

  let running = false;
  let museReady = false;
  let assistantEl = null;

  function scrollBottom() {
    transcript.scrollTop = transcript.scrollHeight;
  }

  function addMsg(className, text, label) {
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
    body.textContent = text;
    el.appendChild(body);
    transcript.appendChild(el);
    scrollBottom();
    return el;
  }

  function setRunning(value) {
    running = value;
    sendBtn.disabled = value || !museReady;
    stopBtn.disabled = !value;
    input.disabled = value || !museReady;
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

  sendBtn.addEventListener("click", submit);
  stopBtn.addEventListener("click", function () {
    vscode.postMessage({ type: "stop" });
  });
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
      case "cleared":
        transcript.innerHTML = "";
        assistantEl = null;
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
        if (msg.text && !body.textContent) {
          body.textContent = msg.text;
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
        addMsg(
          "tool",
          truncate(msg.result || "", 2000),
          "tool: " + (msg.name || "tool"),
        );
        break;
      case "task":
        addMsg("task", msg.text || "", "task");
        break;
      case "stderr":
        addMsg("stderr", msg.text || "", "muse");
        break;
      case "error":
        addMsg("error", msg.text || "", "error");
        break;
      case "unknown":
        addMsg(
          "unknown",
          truncate(JSON.stringify(msg.payload || {}, null, 2), 1200),
          msg.payloadType || "unknown",
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
